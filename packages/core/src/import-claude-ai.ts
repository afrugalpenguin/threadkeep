import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeMachineArchiveFile, type HansardContext } from './config.js';
import { ingestArchive, type IngestResult } from './ingest.js';
import { withLock } from './lock.js';
import { mkdirPrivate, relativeWithin } from './paths.js';
import { claudeAiAdapter, archiveDir } from './adapters/claude-ai/index.js';
import { CONVERSATIONS_ENTRY, zipEntryNames } from './adapters/claude-ai/zip.js';
import { openDb } from './store/db.js';

export interface ImportReport {
  conversationsParts: number;
  imported: number;
  alreadyImported: number;
  failed: number;
  // Conversations parts a manifest listed that were not on disk. The caller turns this into a non-zero exit.
  missingConversationsParts: number;
  newConversations: number;
  newEvents: number;
  updatedEvents: number;
  infos: string[];
  warnings: string[];
}

export interface ImportOptions {
  waitMs?: number;
  // Called with a running conversation count every 100 conversations.
  onProgress?: (conversations: number) => void;
}

// Parts of a full export that have no adapter yet. The same archive layout will host them later.
const OTHER_PARTS = /^(projects|memories|design_chats|frames|light_metadata)/i;

interface Candidate {
  file: string;
  category: string | null;
}

function listZips(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith('.zip'))
    .sort()
    .map((n) => path.join(dir, n));
}

function resolveInputs(inputs: string[], report: ImportReport): { found: Candidate[] } {
  const found: Candidate[] = [];
  for (const input of inputs) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(input);
    } catch {
      report.warnings.push(`${path.basename(input)}: not found`);
      report.failed += 1;
      continue;
    }
    if (stat.isDirectory()) {
      for (const file of listZips(input)) found.push({ file, category: null });
    } else if (input.toLowerCase().endsWith('.json')) {
      let manifest: { data_files?: unknown };
      try {
        manifest = JSON.parse(fs.readFileSync(input, 'utf8')) as { data_files?: unknown };
      } catch {
        report.warnings.push(`${path.basename(input)}: manifest is not valid JSON`);
        report.failed += 1;
        continue;
      }
      if (!Array.isArray(manifest.data_files)) {
        report.warnings.push(`${path.basename(input)}: manifest has no data_files`);
        report.failed += 1;
        continue;
      }
      const dir = path.dirname(input);
      for (const entry of manifest.data_files as Record<string, unknown>[]) {
        const filename = typeof entry['filename'] === 'string' ? entry['filename'] : null;
        const category = typeof entry['category'] === 'string' ? entry['category'] : null;
        // export_url is never fetched; only the local file next to the manifest is used.
        if (!filename) continue;
        const resolved = path.resolve(dir, filename);
        if (relativeWithin(dir, resolved) === null || relativeWithin(dir, resolved) === '') {
          report.warnings.push(`${path.basename(filename)}: manifest entry points outside its directory, skipped`);
          report.failed += 1;
          continue;
        }
        if (!fs.existsSync(resolved)) {
          const skippable = (category !== null && OTHER_PARTS.test(category)) || OTHER_PARTS.test(path.basename(filename));
          report.warnings.push(`${path.basename(filename)}: listed in manifest but missing`);
          if (!skippable) report.missingConversationsParts += 1;
          continue;
        }
        found.push({ file: resolved, category });
      }
    } else {
      found.push({ file: input, category: null });
    }
  }
  return { found };
}

function sha256Of(file: string): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (n === 0) break;
      hash.update(buffer.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

// Write to a temp name in the same dir, fsync, rename. A half copied zip never has its final name.
function publish(target: string, write: (fd: number) => void): void {
  // Unique per attempt so a temp file left behind by a crash can never cause EEXIST.
  const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const fd = fs.openSync(temp, 'wx');
  try {
    write(fd);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, target);
}

function copyInto(source: string, target: string): void {
  publish(target, (out) => {
    const input = fs.openSync(source, 'r');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      for (;;) {
        const n = fs.readSync(input, buffer, 0, buffer.length, null);
        if (n === 0) break;
        fs.writeSync(out, buffer, 0, n);
      }
    } finally {
      fs.closeSync(input);
    }
  });
}

const categoryOf = (candidate: Candidate): string => {
  if (candidate.category) return candidate.category;
  return /^([a-z_]+?)(?:_|-|\d|\.)/i.exec(path.basename(candidate.file))?.[1]?.toLowerCase() ?? 'unknown';
};

export async function importClaudeAi(
  ctx: HansardContext,
  inputs: string[],
  options: ImportOptions = {},
): Promise<ImportReport> {
  const report: ImportReport = {
    conversationsParts: 0,
    imported: 0,
    alreadyImported: 0,
    failed: 0,
    missingConversationsParts: 0,
    newConversations: 0,
    newEvents: 0,
    updatedEvents: 0,
    infos: [],
    warnings: [],
  };
  const { found } = resolveInputs(inputs, report);

  return withLock(ctx, { waitMs: options.waitMs ?? 30_000, onWarning: (w) => report.warnings.push(w) }, async () => {
    mkdirPrivate(archiveDir(ctx));
    writeMachineArchiveFile(ctx);
    const db = openDb(ctx.dbPath);
    let done = 0;
    try {
      for (const candidate of found) {
        const name = path.basename(candidate.file);
        if (candidate.category !== null && OTHER_PARTS.test(candidate.category)) {
          report.infos.push(`skipped ${candidate.category} part (no adapter yet)`);
          continue;
        }
        if (candidate.category === null && OTHER_PARTS.test(name)) {
          report.infos.push(`skipped ${categoryOf(candidate)} part (no adapter yet)`);
          continue;
        }
        let entries: string[];
        try {
          entries = await zipEntryNames(candidate.file);
        } catch {
          report.warnings.push(`${name}: not a readable zip`);
          report.failed += 1;
          continue;
        }
        if (!entries.includes(CONVERSATIONS_ENTRY)) {
          report.infos.push(`skipped ${categoryOf(candidate)} part (no adapter yet)`);
          continue;
        }
        report.conversationsParts += 1;
        const sha = sha256Of(candidate.file);
        if (db.prepare('select 1 from imports where sha256 = ?').get(sha)) {
          report.alreadyImported += 1;
          report.infos.push(`already imported ${name}`);
          continue;
        }
        // Fully stream-parse before archiving anything: a bad export must never reach the shared archive.
        try {
          const probe = { machineId: ctx.machineId, relPath: name, absPath: candidate.file };
          for await (const part of claudeAiAdapter.parseArchive?.(probe, ctx) ?? []) void part;
        } catch {
          report.warnings.push(`${name}: not a valid conversations export, not imported`);
          report.failed += 1;
          report.conversationsParts -= 1;
          continue;
        }
        const target = path.join(archiveDir(ctx), `${sha}.zip`);
        const sidecar = path.join(archiveDir(ctx), `${sha}.json`);
        const importedAt = new Date().toISOString();
        // Sidecar first: a zip must never be visible in the archive without its machine id.
        if (!fs.existsSync(sidecar)) {
          const body = JSON.stringify({ sha256: sha, machine_id: ctx.machineId, original_name: name, imported_at: importedAt }, null, 2);
          publish(sidecar, (fd) => fs.writeSync(fd, `${body}\n`));
        }
        if (!fs.existsSync(target)) copyInto(candidate.file, target);

        const file = claudeAiAdapter.archiveFiles(ctx).find((f) => f.absPath === target);
        if (!file) {
          report.warnings.push(`${name}: archived copy not found after import`);
          report.failed += 1;
          continue;
        }
        const result: IngestResult = {
          sourceFilesScanned: 0,
          mirroredFiles: 0,
          mirroredBytes: 0,
          filesIngested: 0,
          newEvents: 0,
          updatedEvents: 0,
          newRaw: 0,
          failedFiles: 0,
          files: [],
          warnings: [],
        };
        await ingestArchive(ctx, db, [{ adapter: claudeAiAdapter, file }], result, {
          onRecords: (n) => options.onProgress?.(done + n),
        });
        done += result.newRaw;
        report.warnings.push(...result.warnings);
        report.newConversations += result.newRaw;
        report.newEvents += result.newEvents;
        report.updatedEvents += result.updatedEvents;
        db.prepare('insert into imports (path, sha256, imported_at, counts) values (?, ?, ?, ?)').run(
          name,
          sha,
          importedAt,
          JSON.stringify({ conversations: result.newRaw, newEvents: result.newEvents, updatedEvents: result.updatedEvents }),
        );
        report.imported += 1;
      }
    } finally {
      db.close();
    }
    return report;
  });
}

import fs from 'node:fs';
import { readExclusions, writeMachineArchiveFile, type HansardContext } from './config.js';
import { applyExclusions } from './exclusions.js';
import { TOOL_OUTPUT_SEPARATOR, splitToolContent, titleFromText } from './ids.js';
import { withLock } from './lock.js';
import { redactText } from './redaction/index.js';
import { adapters } from './adapters/registry.js';
import type { ArchiveFile, MirrorReport, ParseResult, SourceAdapter } from './adapters/types.js';
import { openDb, type Db } from './store/db.js';

export interface IngestResult {
  mirroredFiles: number;
  mirroredBytes: number;
  filesIngested: number;
  newEvents: number;
  newRaw: number;
  warnings: string[];
}

export interface IngestOptions {
  waitMs?: number;
  onProgress?: (done: number, total: number, relPath: string) => void;
}

const emptyResult = (): IngestResult => ({
  mirroredFiles: 0,
  mirroredBytes: 0,
  filesIngested: 0,
  newEvents: 0,
  newRaw: 0,
  warnings: [],
});

function addMirror(result: IngestResult, report: MirrorReport): void {
  result.mirroredFiles += report.filesMirrored;
  result.mirroredBytes += report.bytesAppended;
  for (const skip of report.skipped) result.warnings.push(`${skip.relPath}: ${skip.reason}`);
}

const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

function mergePaths(a: string | null, b: string[] | undefined): string | null {
  const merged = new Set<string>([...(a ? (JSON.parse(a) as string[]) : []), ...(b ?? [])]);
  return merged.size === 0 ? null : JSON.stringify([...merged].sort());
}

interface Counts {
  newEvents: number;
  newRaw: number;
}

// All db writes for one chunk of one archive file, run inside the caller's transaction.
export function writeParsed(
  db: Db,
  adapter: SourceAdapter,
  file: ArchiveFile,
  parsed: ParseResult,
  touchedSessions: Set<string>,
): Counts {
  const counts: Counts = { newEvents: 0, newRaw: 0 };
  const source = adapter.id;
  const insertRaw = db.prepare(
    'insert into raw_records (source, machine_id, location, byte_offset, session_id, raw, unparsed) values (?, ?, ?, ?, ?, ?, ?) on conflict do nothing',
  );
  const findRaw = db.prepare('select id from raw_records where source = ? and location = ? and byte_offset = ?');
  const rawIds = parsed.records.map((record) => {
    const info = insertRaw.run(source, file.machineId, file.relPath, record.byteOffset, record.sessionId, record.raw, record.unparsed ? 1 : 0);
    counts.newRaw += info.changes;
    if (record.sessionId) touchedSessions.add(record.sessionId);
    return (findRaw.get(source, file.relPath, record.byteOffset) as { id: number }).id;
  });

  const ensureSession = db.prepare('insert or ignore into sessions (id, source, machine_id) values (?, ?, ?)');
  const ensure = (id: string) => {
    ensureSession.run(id, source, file.machineId);
    touchedSessions.add(id);
  };

  const insertText = db.prepare(
    `insert into events (id, raw_id, source, machine_id, session_id, project_dir, timestamp, role, kind, content, content_redacted, files_touched, attachments)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (id) do nothing`,
  );
  const getEvent = db.prepare('select * from events where id = ?');
  const insertTool = db.prepare(
    `insert into events (id, raw_id, source, machine_id, session_id, project_dir, timestamp, role, kind, content, content_redacted, tool_name, tool_input, tool_input_redacted, tool_output, tool_output_redacted, files_touched)
     values (?, ?, ?, ?, ?, ?, ?, 'tool', 'tool', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateTool = db.prepare(
    `update events set raw_id = ?, project_dir = ?, timestamp = ?, content = ?, content_redacted = ?, tool_name = ?,
       tool_input = ?, tool_input_redacted = ?, tool_output = ?, tool_output_redacted = ?, files_touched = ? where id = ?`,
  );

  type Row = Record<string, string | number | null>;
  // Either half of a tool call (the use or its result) can arrive first; both converge to the same row.
  const upsertTool = (
    id: string,
    part: {
      recordIndex: number;
      sessionId: string;
      projectDir: string | null;
      timestamp: string | null;
      files: string[] | undefined;
      use?: { summary: string; name: string | undefined; input: string | undefined };
      result?: { output: string; text: string };
    },
  ) => {
    ensure(part.sessionId);
    const row = getEvent.get(id) as Row | undefined;
    const old = splitToolContent((row?.['content'] as string | null | undefined) ?? null);
    const summary = part.use ? part.use.summary : old.summary;
    const outputText = part.result ? part.result.text : old.output;
    const content = outputText === null ? summary : `${summary}${TOOL_OUTPUT_SEPARATOR}${outputText}`;
    const toolName = part.use?.name ?? (row?.['tool_name'] as string | null | undefined) ?? null;
    const toolInput = part.use?.input ?? (row?.['tool_input'] as string | null | undefined) ?? null;
    const toolOutput = part.result?.output ?? (row?.['tool_output'] as string | null | undefined) ?? null;
    const rawId = part.use ? rawIds[part.recordIndex] : ((row?.['raw_id'] as number | null | undefined) ?? rawIds[part.recordIndex]);
    const projectDir = part.use ? (part.projectDir ?? (row?.['project_dir'] as string | null | undefined) ?? null) : ((row?.['project_dir'] as string | null | undefined) ?? part.projectDir);
    const timestamp = part.use ? (part.timestamp ?? (row?.['timestamp'] as string | null | undefined) ?? null) : ((row?.['timestamp'] as string | null | undefined) ?? part.timestamp);
    const files = mergePaths((row?.['files_touched'] as string | null | undefined) ?? null, part.files);
    const values = [
      content,
      redactText(content),
      toolName,
      toolInput,
      redactText(toolInput),
      toolOutput,
      redactText(toolOutput),
      files,
    ] as const;
    if (!row) {
      insertTool.run(id, rawId, source, file.machineId, part.sessionId, projectDir, timestamp, ...values);
      if (part.use) counts.newEvents += 1;
    } else {
      if (part.use && row['tool_input'] === null) counts.newEvents += 1;
      updateTool.run(rawId, projectDir, timestamp, ...values, id);
    }
  };

  for (const event of parsed.events) {
    ensure(event.sessionId);
    if (event.kind === 'tool') {
      upsertTool(event.id, {
        recordIndex: event.recordIndex,
        sessionId: event.sessionId,
        projectDir: event.projectDir,
        timestamp: event.timestamp,
        files: event.filesTouched,
        use: { summary: event.content, name: event.toolName, input: event.toolInput },
      });
      continue;
    }
    const info = insertText.run(
      event.id,
      rawIds[event.recordIndex],
      source,
      file.machineId,
      event.sessionId,
      event.projectDir,
      event.timestamp,
      event.role,
      event.kind,
      event.content,
      redactText(event.content),
      event.filesTouched ? json(event.filesTouched) : null,
      json(event.attachments),
    );
    counts.newEvents += info.changes;
  }

  for (const patch of parsed.patches) {
    upsertTool(patch.eventId, {
      recordIndex: patch.recordIndex,
      sessionId: patch.sessionId,
      projectDir: patch.projectDir,
      timestamp: patch.timestamp,
      files: patch.filesTouched,
      result: { output: patch.toolOutput, text: patch.outputText },
    });
  }

  const setCwd = db.prepare('update sessions set project_dir = coalesce(project_dir, ?) where id = ?');
  const setTitle = db.prepare('update sessions set title = ? where id = ?');
  for (const update of parsed.sessions) {
    ensure(update.sessionId);
    if (update.cwd) setCwd.run(update.cwd, update.sessionId);
    if (update.aiTitle) setTitle.run(redactText(update.aiTitle), update.sessionId);
  }
  return counts;
}

// Sessions derived fields, recomputed with sql after each chunk.
export function refreshSessions(db: Db, ids: Iterable<string>): void {
  const stats = db.prepare(
    `update sessions set
       started_at = (select min(timestamp) from events where session_id = sessions.id),
       ended_at = (select max(timestamp) from events where session_id = sessions.id),
       event_count = (select count(*) from events where session_id = sessions.id)
     where id = ?`,
  );
  const fallback = db.prepare(
    `update sessions set title = ? where id = ? and (title is null or title = '')`,
  );
  const firstUser = db.prepare(
    `select content from events where session_id = ? and role = 'user' and kind = 'text' and content != ''
     order by timestamp, rowid limit 1`,
  );
  for (const id of ids) {
    stats.run(id);
    const row = firstUser.get(id) as { content: string } | undefined;
    if (row) fallback.run(redactText(titleFromText(row.content)), id);
  }
}

function ingestLineFile(ctx: HansardContext, db: Db, adapter: SourceAdapter, file: ArchiveFile, result: IngestResult): boolean {
  const reason = adapter.skipReason?.(file);
  if (reason) {
    result.warnings.push(`${file.relPath}: ${reason}`);
    return false;
  }
  const state = db
    .prepare('select byte_offset from ingest_state where adapter = ? and key = ?')
    .get(adapter.id, file.relPath) as { byte_offset: number } | undefined;
  const offset = state?.byte_offset ?? 0;
  let size: number;
  try {
    size = fs.statSync(file.absPath).size;
  } catch {
    result.warnings.push(`${file.relPath}: archive file unreadable, skipped`);
    return false;
  }
  if (size < offset) {
    result.warnings.push(`${file.relPath}: archive file shorter than ingested offset, skipped`);
    return false;
  }
  if (size === offset) return false;
  const fd = fs.openSync(file.absPath, 'r');
  let buffer: Buffer;
  try {
    buffer = Buffer.alloc(size - offset);
    let read = 0;
    while (read < buffer.length) {
      const n = fs.readSync(fd, buffer, read, buffer.length - read, offset + read);
      if (n === 0) break;
      read += n;
    }
    buffer = buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
  const lastNewline = buffer.lastIndexOf(0x0a);
  if (lastNewline < 0) return false; // only a partial line so far
  const text = buffer.subarray(0, lastNewline + 1).toString('utf8');
  const parsed = adapter.parse(file, { text, startOffset: offset }, ctx);
  const touched = new Set<string>();
  const counts = db.transaction(() => {
    const written = writeParsed(db, adapter, file, parsed, touched);
    refreshSessions(db, touched);
    applyExclusions(db, readExclusions(ctx), touched);
    db.prepare(
      'insert into ingest_state (adapter, key, byte_offset, mtime, extra) values (?, ?, ?, ?, null) on conflict (adapter, key) do update set byte_offset = excluded.byte_offset, mtime = excluded.mtime',
    ).run(adapter.id, file.relPath, offset + lastNewline + 1, new Date().toISOString());
    return written;
  })();
  result.warnings.push(...parsed.warnings);
  result.newEvents += counts.newEvents;
  result.newRaw += counts.newRaw;
  return counts.newRaw > 0 || counts.newEvents > 0;
}

function ingestArchive(
  ctx: HansardContext,
  db: Db,
  files: { adapter: SourceAdapter; file: ArchiveFile }[],
  result: IngestResult,
  options: IngestOptions,
): void {
  files.forEach(({ adapter, file }, index) => {
    if (ingestLineFile(ctx, db, adapter, file, result)) result.filesIngested += 1;
    options.onProgress?.(index + 1, files.length, file.relPath);
  });
}

export async function ingestAll(ctx: HansardContext, options: IngestOptions = {}): Promise<IngestResult> {
  const result = emptyResult();
  return withLock(ctx, { waitMs: options.waitMs ?? 30_000, onWarning: (w) => result.warnings.push(w) }, () => {
    fs.mkdirSync(ctx.archiveRoot, { recursive: true });
    writeMachineArchiveFile(ctx);
    for (const adapter of adapters) {
      if (adapter.kind === 'live' && adapter.mirror) addMirror(result, adapter.mirror(ctx));
    }
    const db = openDb(ctx.dbPath);
    try {
      const files = adapters.flatMap((adapter) => adapter.archiveFiles(ctx).map((file) => ({ adapter, file })));
      ingestArchive(ctx, db, files, result, options);
    } finally {
      db.close();
    }
    return result;
  });
}

// Used by hooks: mirror and ingest one local session file.
export async function ingestFile(ctx: HansardContext, localPath: string, options: IngestOptions = {}): Promise<IngestResult> {
  const owner = adapters.find((adapter) => adapter.archiveFileFor?.(ctx, localPath));
  if (!owner || !owner.archiveFileFor || !owner.mirror) throw new Error('path is not under any configured source root');
  const file = owner.archiveFileFor(ctx, localPath) as ArchiveFile;
  const result = emptyResult();
  return withLock(ctx, { waitMs: options.waitMs ?? 30_000, onWarning: (w) => result.warnings.push(w) }, () => {
    fs.mkdirSync(ctx.archiveRoot, { recursive: true });
    writeMachineArchiveFile(ctx);
    addMirror(result, (owner.mirror as NonNullable<SourceAdapter['mirror']>)(ctx, { file: localPath }));
    const db = openDb(ctx.dbPath);
    try {
      if (fs.existsSync(file.absPath)) ingestArchive(ctx, db, [{ adapter: owner, file }], result, options);
    } finally {
      db.close();
    }
    return result;
  });
}

export interface RebuildResult {
  sessions: number;
  events: number;
  raw: number;
  warnings: string[];
}

// Drops everything derived from the archive and re-ingests it with the current parsers and redaction patterns.
// Decisions, links and imports are local state and are kept.
export async function rebuild(ctx: HansardContext, options: IngestOptions = {}): Promise<RebuildResult> {
  const result = emptyResult();
  return withLock(ctx, { waitMs: options.waitMs ?? 30_000, onWarning: (w) => result.warnings.push(w) }, () => {
    const db = openDb(ctx.dbPath);
    try {
      db.transaction(() => {
        db.exec('delete from events; delete from raw_records; delete from sessions; delete from ingest_state');
      })();
      const files = adapters.flatMap((adapter) => adapter.archiveFiles(ctx).map((file) => ({ adapter, file })));
      ingestArchive(ctx, db, files, result, options);
      const count = (table: string) => (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
      return { sessions: count('sessions'), events: count('events'), raw: count('raw_records'), warnings: result.warnings };
    } finally {
      db.close();
    }
  });
}

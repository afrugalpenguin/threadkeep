import fs from 'node:fs';
import { mkdirPrivate } from './paths.js';
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
  updatedEvents: number;
  newRaw: number;
  // Archive files that failed to ingest and were skipped; the rest of the run still completes.
  failedFiles: number;
  warnings: string[];
}

export interface IngestOptions {
  waitMs?: number;
  onProgress?: (done: number, total: number, relPath: string) => void;
  // Import adapters: called each time another 100 records of the current archive file are written.
  onRecords?: (count: number) => void;
}

const emptyResult = (): IngestResult => ({
  mirroredFiles: 0,
  mirroredBytes: 0,
  filesIngested: 0,
  newEvents: 0,
  updatedEvents: 0,
  newRaw: 0,
  failedFiles: 0,
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

export interface Counts {
  newEvents: number;
  updatedEvents: number;
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
  const counts: Counts = { newEvents: 0, updatedEvents: 0, newRaw: 0 };
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

  const getVersion = db.prepare('select source_updated_at as v from events where id = ?');
  const upsertVersioned = db.prepare(
    `insert into events (id, raw_id, source, machine_id, session_id, project_dir, timestamp, role, kind, content, content_redacted,
       tool_name, tool_input, tool_input_redacted, tool_output, tool_output_redacted, files_touched, attachments, source_updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (id) do update set
       raw_id = case when excluded.source_updated_at > coalesce(events.source_updated_at, '') then excluded.raw_id else events.raw_id end,
       timestamp = excluded.timestamp, role = excluded.role, kind = excluded.kind,
       content = excluded.content, content_redacted = excluded.content_redacted,
       tool_name = excluded.tool_name, tool_input = excluded.tool_input, tool_input_redacted = excluded.tool_input_redacted,
       tool_output = excluded.tool_output, tool_output_redacted = excluded.tool_output_redacted,
       files_touched = excluded.files_touched, attachments = excluded.attachments,
       source_updated_at = excluded.source_updated_at
     where excluded.source_updated_at >= coalesce(events.source_updated_at, '')`,
  );

  for (const event of parsed.events) {
    ensure(event.sessionId);
    if (event.sourceUpdatedAt !== undefined) {
      // Edited re-exports update in place; an older copy never overwrites a newer one and nothing is deleted.
      const stored = getVersion.get(event.id) as { v: string | null } | undefined;
      upsertVersioned.run(
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
        event.toolName ?? null,
        event.toolInput ?? null,
        redactText(event.toolInput ?? null),
        event.toolOutput ?? null,
        redactText(event.toolOutput ?? null),
        event.filesTouched && event.filesTouched.length > 0 ? json(event.filesTouched) : null,
        event.attachments && event.attachments.length > 0 ? json(event.attachments) : null,
        event.sourceUpdatedAt,
      );
      if (stored === undefined) counts.newEvents += 1;
      else if (event.sourceUpdatedAt > (stored.v ?? '')) counts.updatedEvents += 1;
      continue;
    }
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
  const setSourceTitle = db.prepare(
    `update sessions set title = ?, source_updated_at = ? where id = ? and ? >= coalesce(source_updated_at, '')`,
  );
  for (const update of parsed.sessions) {
    ensure(update.sessionId);
    if (update.cwd) setCwd.run(update.cwd, update.sessionId);
    if (update.aiTitle) setTitle.run(redactText(update.aiTitle), update.sessionId);
    if (update.title) {
      // Redact the full text first, then truncate, so a secret straddling the cut cannot survive.
      const redacted = redactText(update.title.value) ?? '';
      const value = update.title.fallback ? titleFromText(redacted) : redacted;
      setSourceTitle.run(value, update.title.updatedAt, update.sessionId, update.title.updatedAt);
    }
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
    `select content_redacted as content from events where session_id = ? and role = 'user' and kind = 'text' and content != ''
     order by timestamp, rowid limit 1`,
  );
  for (const id of ids) {
    stats.run(id);
    const row = firstUser.get(id) as { content: string } | undefined;
    if (row) fallback.run(titleFromText(row.content), id);
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
  result.updatedEvents += counts.updatedEvents;
  result.newRaw += counts.newRaw;
  return counts.newRaw > 0 || counts.newEvents > 0;
}

const BATCH = 25;

function mergeParsed(parts: ParseResult[]): ParseResult {
  const out: ParseResult = { records: [], events: [], patches: [], sessions: [], warnings: [] };
  for (const part of parts) {
    const base = out.records.length;
    out.records.push(...part.records);
    out.events.push(...part.events.map((e) => ({ ...e, recordIndex: e.recordIndex + base })));
    out.patches.push(...part.patches.map((p) => ({ ...p, recordIndex: p.recordIndex + base })));
    out.sessions.push(...part.sessions);
    out.warnings.push(...part.warnings);
  }
  return out;
}

// Import adapters stream an immutable archive file; it is marked done once fully ingested.
async function ingestImportFile(
  ctx: HansardContext,
  db: Db,
  adapter: SourceAdapter,
  file: ArchiveFile,
  result: IngestResult,
  options: IngestOptions,
): Promise<boolean> {
  const reason = adapter.skipReason?.(file);
  if (reason) {
    result.warnings.push(`${file.relPath}: ${reason}`);
    return false;
  }
  let size: number;
  try {
    size = fs.statSync(file.absPath).size;
  } catch {
    result.warnings.push(`${file.relPath}: archive file unreadable, skipped`);
    return false;
  }
  const state = db
    .prepare('select byte_offset, extra from ingest_state where adapter = ? and key = ?')
    .get(adapter.id, file.relPath) as { byte_offset: number; extra: string | null } | undefined;
  if (state?.extra === 'done' && state.byte_offset === size) return false;

  let changed = false;
  const writeBatch = (batch: ParseResult[]) => {
    const merged = mergeParsed(batch);
    const touched = new Set<string>();
    const counts = db.transaction(() => {
      const written = writeParsed(db, adapter, file, merged, touched);
      refreshSessions(db, touched);
      applyExclusions(db, readExclusions(ctx), touched);
      return written;
    })();
    result.warnings.push(...merged.warnings);
    result.newEvents += counts.newEvents;
    result.updatedEvents += counts.updatedEvents;
    result.newRaw += counts.newRaw;
    if (counts.newRaw > 0 || counts.newEvents > 0 || counts.updatedEvents > 0) changed = true;
  };
  let batch: ParseResult[] = [];
  let seen = 0;
  const flush = () => {
    const before = seen;
    writeBatch(batch);
    seen += batch.length;
    batch = [];
    for (let mark = (Math.floor(before / 100) + 1) * 100; mark <= seen; mark += 100) options.onRecords?.(mark);
  };
  for await (const part of (adapter.parseArchive as NonNullable<SourceAdapter['parseArchive']>)(file, ctx)) {
    batch.push(part);
    if (batch.length >= BATCH) flush();
  }
  if (batch.length > 0) flush();
  db.prepare(
    `insert into ingest_state (adapter, key, byte_offset, mtime, extra) values (?, ?, ?, ?, 'done')
     on conflict (adapter, key) do update set byte_offset = excluded.byte_offset, mtime = excluded.mtime, extra = 'done'`,
  ).run(adapter.id, file.relPath, size, new Date().toISOString());
  return changed;
}

export async function ingestArchive(
  ctx: HansardContext,
  db: Db,
  files: { adapter: SourceAdapter; file: ArchiveFile }[],
  result: IngestResult,
  options: IngestOptions,
): Promise<void> {
  let index = 0;
  for (const { adapter, file } of files) {
    // Let timers (the lock heartbeat) run between files; ingest is otherwise synchronous.
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      const changed = adapter.parseArchive
        ? await ingestImportFile(ctx, db, adapter, file, result, options)
        : ingestLineFile(ctx, db, adapter, file, result);
      if (changed) result.filesIngested += 1;
    } catch {
      // One bad file must not block every other file. No error text: it can quote content.
      result.warnings.push(`${file.relPath}: ingest failed, skipped`);
      result.failedFiles += 1;
    }
    index += 1;
    options.onProgress?.(index, files.length, file.relPath);
  }
}

export async function ingestAll(ctx: HansardContext, options: IngestOptions = {}): Promise<IngestResult> {
  const result = emptyResult();
  return withLock(ctx, { waitMs: options.waitMs ?? 30_000, onWarning: (w) => result.warnings.push(w) }, async () => {
    mkdirPrivate(ctx.archiveRoot);
    writeMachineArchiveFile(ctx);
    for (const adapter of adapters) {
      if (adapter.kind === 'live' && adapter.mirror) addMirror(result, adapter.mirror(ctx));
    }
    const db = openDb(ctx.dbPath);
    try {
      const files = adapters.flatMap((adapter) => adapter.archiveFiles(ctx, (w) => result.warnings.push(w)).map((file) => ({ adapter, file })));
      await ingestArchive(ctx, db, files, result, options);
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
  return withLock(ctx, { waitMs: options.waitMs ?? 30_000, onWarning: (w) => result.warnings.push(w) }, async () => {
    mkdirPrivate(ctx.archiveRoot);
    writeMachineArchiveFile(ctx);
    addMirror(result, (owner.mirror as NonNullable<SourceAdapter['mirror']>)(ctx, { file: localPath }));
    const db = openDb(ctx.dbPath);
    try {
      if (fs.existsSync(file.absPath)) await ingestArchive(ctx, db, [{ adapter: owner, file }], result, options);
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
  failedFiles: number;
  warnings: string[];
}

// Drops everything derived from the archive and re-ingests it with the current parsers and redaction patterns.
// Decisions, links and imports are local state and are kept.
export async function rebuild(ctx: HansardContext, options: IngestOptions = {}): Promise<RebuildResult> {
  const result = emptyResult();
  return withLock(ctx, { waitMs: options.waitMs ?? 30_000, onWarning: (w) => result.warnings.push(w) }, async () => {
    const db = openDb(ctx.dbPath);
    try {
      db.transaction(() => {
        db.exec('delete from events; delete from raw_records; delete from sessions; delete from ingest_state');
      })();
      const files = adapters.flatMap((adapter) => adapter.archiveFiles(ctx, (w) => result.warnings.push(w)).map((file) => ({ adapter, file })));
      await ingestArchive(ctx, db, files, result, options);
      const count = (table: string) => (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
      return { sessions: count('sessions'), events: count('events'), raw: count('raw_records'), failedFiles: result.failedFiles, warnings: result.warnings };
    } finally {
      db.close();
    }
  });
}

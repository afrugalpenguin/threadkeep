import fs from 'node:fs';
import path from 'node:path';
import type { HansardContext } from './config.js';
import { splitToolContent } from './ids.js';
import { adapters } from './adapters/registry.js';
import type { Db } from './store/db.js';

// Everything here reads only redacted columns. Excluded sessions never appear.

export class UsageError extends Error {}
export class NotFoundError extends Error {}
export class AmbiguousError extends Error {}

export function parseSince(value: string, now: Date = new Date()): string {
  const relative = /^(\d+)([hdw])$/.exec(value.trim());
  if (relative) {
    const unit = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[relative[2] as 'h' | 'd' | 'w'];
    return new Date(now.getTime() - Number(relative[1]) * unit).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(value.trim()) && !Number.isNaN(Date.parse(value))) return value.trim();
  throw new UsageError(`invalid --since value: ${value} (use an ISO date or a duration like 12h, 7d, 2w)`);
}

// One quoted token per whitespace-separated word, ANDed, so user input can never be FTS5 syntax.
export function ftsQuery(query: string): string {
  const tokens = query.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) throw new UsageError('empty search query');
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
}

export interface SearchOptions {
  query: string;
  source?: string;
  project?: string;
  since?: string;
  role?: string;
  machine?: string;
  sort?: 'rank' | 'time';
  thinking?: boolean;
  limit?: number;
  marks?: [string, string];
}

export interface SearchHit {
  session_id: string;
  event_id: string;
  timestamp: string | null;
  role: string;
  kind: string;
  project_dir: string | null;
  machine_id: string;
  source: string;
  title: string | null;
  snippet: string;
}

export function search(db: Db, options: SearchOptions): SearchHit[] {
  const where = ['events_fts match ?', 's.excluded = 0'];
  const [open, close] = options.marks ?? ['[', ']'];
  // snippet's bound params appear first in the SQL text, so they come first here
  const params: (string | number)[] = [open, close, ftsQuery(options.query)];
  if (!options.thinking) where.push("e.kind != 'thinking'");
  if (options.source) (where.push('e.source = ?'), params.push(options.source));
  if (options.project) (where.push('instr(lower(e.project_dir), lower(?)) > 0'), params.push(options.project));
  if (options.since) (where.push('e.timestamp >= ?'), params.push(parseSince(options.since)));
  if (options.role) (where.push('e.role = ?'), params.push(options.role));
  if (options.machine) (where.push('e.machine_id = ?'), params.push(options.machine));
  params.push(options.limit ?? 20);
  const order = options.sort === 'time' ? 'e.timestamp desc, e.rowid desc' : 'rank';
  const rows = db
    .prepare(
      `select e.session_id, e.id as event_id, e.timestamp, e.role, e.kind, e.project_dir, e.machine_id, e.source, s.title,
         snippet(events_fts, 0, ?, ?, '...', 12) as snippet, substr(e.content_redacted, 1, 120) as head
       from events_fts
       join events e on e.rowid = events_fts.rowid
       join sessions s on s.id = e.session_id
       where ${where.join(' and ')}
       order by ${order}
       limit ?`,
    )
    .all(...params) as (SearchHit & { head: string | null })[];
  return rows.map(({ head, ...hit }) => ({ ...hit, snippet: hit.snippet || head || '' }));
}

export interface SessionRow {
  id: string;
  source: string;
  machine_id: string;
  project_dir: string | null;
  started_at: string | null;
  ended_at: string | null;
  event_count: number;
  title: string | null;
}

export interface ListSessionsOptions {
  source?: string;
  project?: string;
  since?: string;
  machine?: string;
  sort?: 'time' | 'project' | 'source' | 'length';
  limit?: number;
  offset?: number;
}

export function listSessions(db: Db, options: ListSessionsOptions = {}): SessionRow[] {
  const where = ['excluded = 0'];
  const params: (string | number)[] = [];
  if (options.source) (where.push('source = ?'), params.push(options.source));
  if (options.project) (where.push('instr(lower(project_dir), lower(?)) > 0'), params.push(options.project));
  if (options.since) (where.push('started_at >= ?'), params.push(parseSince(options.since)));
  if (options.machine) (where.push('machine_id = ?'), params.push(options.machine));
  const order = {
    time: 'started_at desc',
    project: 'project_dir, started_at desc',
    source: 'source, started_at desc',
    length: 'event_count desc',
  }[options.sort ?? 'time'];
  params.push(options.limit ?? 50);
  params.push(options.offset ?? 0);
  return db
    .prepare(
      `select id, source, machine_id, project_dir, started_at, ended_at, event_count, title from sessions
       where ${where.join(' and ')} order by ${order}, id limit ? offset ?`,
    )
    .all(...params) as SessionRow[];
}

export interface ShownEvent {
  id: string;
  timestamp: string | null;
  role: string;
  kind: string;
  content: string;
  tool_name: string | null;
  tool_input?: string | null;
  tool_output?: string | null;
  files_touched: string[];
  attachments: unknown[];
}

export interface ShownSession {
  session: SessionRow;
  events: ShownEvent[];
}

export function getSession(
  db: Db,
  idOrPrefix: string,
  options: { thinking?: boolean; expandTools?: boolean } = {},
): ShownSession {
  if (!/^[A-Za-z0-9_-]+$/.test(idOrPrefix)) throw new NotFoundError('session not found');
  const matches = db
    .prepare("select id from sessions where excluded = 0 and substr(id, 1, ?) = ? order by id limit 2")
    .all(idOrPrefix.length, idOrPrefix) as { id: string }[];
  if (matches.length === 0) throw new NotFoundError('session not found');
  if (matches.length > 1) {
    const count = (
      db.prepare('select count(*) as n from sessions where excluded = 0 and substr(id, 1, ?) = ?').get(idOrPrefix.length, idOrPrefix) as { n: number }
    ).n;
    throw new AmbiguousError(`ambiguous session id prefix: ${count} sessions match`);
  }
  const id = (matches[0] as { id: string }).id;
  const session = db
    .prepare('select id, source, machine_id, project_dir, started_at, ended_at, event_count, title from sessions where id = ?')
    .get(id) as SessionRow;
  const raw = db
    .prepare(
      `select id, timestamp, role, kind, content_redacted as content, tool_name, tool_input_redacted, tool_output_redacted,
         files_touched, attachments from events where session_id = ? ${options.thinking ? '' : "and kind != 'thinking'"}
       order by timestamp, rowid`,
    )
    .all(id) as Record<string, string | null>[];
  const events = raw.map((r): ShownEvent => {
    const isTool = r['kind'] === 'tool';
    const content = r['content'] ?? '';
    const event: ShownEvent = {
      id: r['id'] as string,
      timestamp: r['timestamp'] ?? null,
      role: r['role'] as string,
      kind: r['kind'] as string,
      content: isTool && !options.expandTools ? splitToolContent(content).summary : content,
      tool_name: r['tool_name'] ?? null,
      files_touched: r['files_touched'] ? (JSON.parse(r['files_touched']) as string[]) : [],
      attachments: r['attachments'] ? (JSON.parse(r['attachments']) as unknown[]) : [],
    };
    if (isTool && options.expandTools) {
      event.tool_input = r['tool_input_redacted'] ?? null;
      event.tool_output = r['tool_output_redacted'] ?? null;
    }
    return event;
  });
  return { session, events };
}

export interface SourceInfo {
  id: string;
  displayName: string;
  kind: 'live' | 'import';
  found: boolean;
  locations: { location: string; found: boolean; detail?: string }[];
}

export function listSources(ctx: HansardContext): SourceInfo[] {
  return adapters.map((adapter) => {
    const locations = adapter.discover(ctx);
    return {
      id: adapter.id,
      displayName: adapter.displayName,
      kind: adapter.kind,
      found: adapter.kind === 'import' ? true : locations.some((l) => l.found),
      locations,
    };
  });
}

export interface MachineInfo {
  id: string;
  label: string | null;
  sessions: number;
  current: boolean;
}

export function machineSummary(ctx: HansardContext, db: Db): MachineInfo[] {
  const labels = new Map<string, string | null>();
  const dir = path.join(ctx.archiveRoot, 'machines');
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as { id?: string; label?: string | null };
        if (parsed.id) labels.set(parsed.id, parsed.label ?? null);
      } catch {
        // an unreadable machine file only costs a label
      }
    }
  } catch {
    // no archive yet
  }
  labels.set(ctx.machineId, ctx.machineLabel);
  const counts = new Map(
    (db.prepare('select machine_id as id, count(*) as n from sessions where excluded = 0 group by machine_id').all() as { id: string; n: number }[]).map(
      (r) => [r.id, r.n],
    ),
  );
  for (const id of counts.keys()) if (!labels.has(id)) labels.set(id, null);
  return [...labels.entries()]
    .map(([id, label]) => ({ id, label, sessions: counts.get(id) ?? 0, current: id === ctx.machineId }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

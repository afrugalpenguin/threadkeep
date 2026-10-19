import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestAll, openDb, type HansardContext } from '../src/index.js';
import { assistant } from '../src/adapters/claude-code/fixtures.js';
import { FIXTURE_SESSIONS, copyFixtures } from './fixture-files.js';
import { makeMachine } from './helpers.js';

const TABLES = ['sessions', 'events', 'raw_records', 'events_fts', 'ingest_state'];

function snapshot(ctx: HansardContext) {
  const db = openDb(ctx.dbPath);
  try {
    const counts = Object.fromEntries(
      TABLES.map((t) => [t, (db.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n]),
    );
    const sessions = db.prepare('select id, project_dir, started_at, ended_at, event_count, title from sessions order by id').all();
    const events = db.prepare('select id, session_id, role, kind, timestamp, content from events order by id').all();
    return { counts, sessions, events };
  } finally {
    db.close();
  }
}

const sessionPath = (claudeRoot: string, s: { id: string; folder: string }) => path.join(claudeRoot, s.folder, `${s.id}.jsonl`);

describe('ingest of the fixture sessions', () => {
  it('reports each file it ingested with its counts, and ignores subagent files', async () => {
    const m = makeMachine();
    copyFixtures(m.claudeRoot);
    const r = await ingestAll(m.ctx);

    expect(r.sourceFilesScanned).toBe(3);
    expect(r.files.map((f) => f.status)).toEqual(['ingested', 'ingested', 'ingested']);
    expect(r.files.every((f) => f.relPath.startsWith(`raw/claude-code/${m.ctx.machineId}/`))).toBe(true);
    expect(r.files.some((f) => f.relPath.includes('subagents'))).toBe(false);
    expect(r.files.reduce((n, f) => n + f.newEvents, 0)).toBe(r.newEvents);
    expect(r.files.reduce((n, f) => n + f.newRaw, 0)).toBe(r.newRaw);
    // 6 + 8 + 5 lines in the three fixture files.
    expect(r.newRaw).toBe(19);
    expect(r.failedFiles).toBe(0);

    const { counts } = snapshot(m.ctx);
    expect(counts['sessions']).toBe(3);
    const db = openDb(m.ctx.dbPath);
    expect(db.prepare("select count(*) as n from events where content like '%zanzibar%'").get()).toEqual({ n: 0 });
    db.close();
  });

  it('is idempotent: a second run inserts nothing and leaves every row as it was', async () => {
    const m = makeMachine();
    copyFixtures(m.claudeRoot);
    await ingestAll(m.ctx);
    const first = snapshot(m.ctx);

    const again = await ingestAll(m.ctx);
    expect(again.mirroredFiles).toBe(0);
    expect(again.newEvents).toBe(0);
    expect(again.newRaw).toBe(0);
    expect(again.files.map((f) => f.status)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(snapshot(m.ctx)).toEqual(first);
  });

  it('picks up only the lines appended to one session', async () => {
    const m = makeMachine();
    copyFixtures(m.claudeRoot);
    await ingestAll(m.ctx);
    const before = snapshot(m.ctx);

    const { id, folder } = FIXTURE_SESSIONS.kestrel;
    fs.appendFileSync(
      sessionPath(m.claudeRoot, { id, folder }),
      assistant({ sessionId: id, uuid: 'a2000000-0000-4000-8000-000000000099', timestamp: '2026-03-09T14:05:00.000Z' }, [
        { type: 'text', text: 'One more thing about the kestrel queue.' },
      ]),
    );
    const r = await ingestAll(m.ctx);
    const changed = r.files.filter((f) => f.status === 'ingested');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.relPath).toContain(id);
    expect(changed[0]).toMatchObject({ newEvents: 1, newRaw: 1 });

    const after = snapshot(m.ctx);
    expect(after.counts['sessions']).toBe(before.counts['sessions']);
    expect(after.counts['events']).toBe((before.counts['events'] ?? 0) + 1);
    expect(after.counts['raw_records']).toBe((before.counts['raw_records'] ?? 0) + 1);
  });

  it('logs a failing file, still ingests the others, and counts the failure', async () => {
    const m = makeMachine();
    copyFixtures(m.claudeRoot);
    const dir = path.join(m.ctx.archiveRoot, 'raw', 'claude-ai');
    const sha = 'b'.repeat(64);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sha}.json`), JSON.stringify({ sha256: sha, machine_id: 'm', original_name: 'x.zip', imported_at: 'now' }));
    fs.writeFileSync(path.join(dir, `${sha}.zip`), 'not a zip');

    const r = await ingestAll(m.ctx);
    expect(r.failedFiles).toBe(1);
    expect(r.files.find((f) => f.relPath === `raw/claude-ai/${sha}.zip`)?.status).toBe('failed');
    expect(r.files.filter((f) => f.status === 'ingested')).toHaveLength(3);
  });
});

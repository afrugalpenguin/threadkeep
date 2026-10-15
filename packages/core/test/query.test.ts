import { describe, expect, it } from 'vitest';
import {
  NotFoundError,
  UsageError,
  applyExclusions,
  changeExclusion,
  getSession,
  ingestAll,
  listSessions,
  machineSummary,
  matchesGlob,
  openDb,
  parseSince,
  readExclusions,
  rebuild,
  search,
  writeExclusions,
  type HansardContext,
} from '../src/index.js';
import { aiTitle, assistant, toolResultLine, userText, FIXTURE_PROJECT_WINDOWS } from '../src/adapters/claude-code/fixtures.js';
import { makeMachine, tempDir, writeSession, type Machine } from './helpers.js';
import path from 'node:path';

const S1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const S2 = 'aaaaaaaa-2222-4222-8222-222222222222';
const S3 = 'bbbbbbbb-3333-4333-8333-333333333333';
const at = (sid: string, n: number, cwd?: string) => ({
  sessionId: sid,
  uuid: `${sid.slice(0, 2)}${n}`,
  timestamp: `2026-02-0${n}T10:00:00.000Z`,
  ...(cwd ? { cwd } : {}),
});

async function seeded(): Promise<Machine> {
  const m = makeMachine();
  writeSession(
    m.claudeRoot,
    S1,
    userText(at(S1, 1), 'alpha unique question about caching') +
      assistant(at(S1, 2), [
        { type: 'thinking', thinking: 'secretly pondering zebra', signature: 's' },
        { type: 'text', text: 'alpha answer about caching layers' },
        { type: 'tool_use', id: 'tt1', name: 'Grep', input: { pattern: 'cachekey' } },
      ]) +
      toolResultLine(at(S1, 3), 'tt1', 'three matches found') +
      aiTitle(S1, 'Caching chat'),
  );
  writeSession(m.claudeRoot, S2, userText(at(S2, 2, '/home/alice/projects/other'), 'beta question about databases'), '-home-alice-projects-other');
  writeSession(m.claudeRoot, S3, userText(at(S3, 3, FIXTURE_PROJECT_WINDOWS), 'gamma question about windows paths'), '-win');
  await ingestAll(m.ctx);
  return m;
}

const withDb = async <T>(ctx: HansardContext, fn: (db: ReturnType<typeof openDb>) => T): Promise<T> => {
  const db = openDb(ctx.dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

describe('search', () => {
  it('filters by source, project, since, role, machine and thinking, and sorts', async () => {
    const m = await seeded();
    await withDb(m.ctx, (db) => {
      expect(search(db, { query: 'question' }).map((h) => h.session_id).sort()).toEqual([S1, S2, S3].sort());
      expect(search(db, { query: 'question', source: 'claude-code' })).toHaveLength(3);
      expect(search(db, { query: 'question', source: 'nothing' })).toHaveLength(0);
      expect(search(db, { query: 'question', project: 'PROJECTS/OTHER' }).map((h) => h.session_id)).toEqual([S2]);
      expect(search(db, { query: 'question', since: '2026-02-03' }).map((h) => h.session_id)).toEqual([S3]);
      expect(search(db, { query: 'caching', role: 'assistant' }).map((h) => h.role)).toEqual(['assistant']);
      expect(search(db, { query: 'question', machine: m.ctx.machineId })).toHaveLength(3);
      expect(search(db, { query: 'question', machine: 'nope' })).toHaveLength(0);
      expect(search(db, { query: 'zebra' })).toHaveLength(0);
      expect(search(db, { query: 'zebra', thinking: true })).toHaveLength(1);
      expect(search(db, { query: 'question', sort: 'time' }).map((h) => h.session_id)).toEqual([S3, S2, S1]);
      expect(search(db, { query: 'question', limit: 1 })).toHaveLength(1);
      expect(search(db, { query: 'Grep' })[0]?.kind).toBe('tool');
    });
  });

  it('uses custom snippet markers when given', async () => {
    const m = await seeded();
    await withDb(m.ctx, (db) => {
      const [hit] = search(db, { query: 'caching', role: 'user', marks: ['\u0002', '\u0003'] });
      expect(hit?.snippet).toContain('\u0002caching\u0003');
      expect(hit?.snippet).not.toContain('[caching]');
      expect(search(db, { query: 'caching', role: 'user' })[0]?.snippet).toContain('[caching]');
    });
  });

  it('survives quotes and fts syntax in the query', async () => {
    const m = await seeded();
    await withDb(m.ctx, (db) => {
      for (const q of ['"', 'a"b', 'AND OR NOT', 'NEAR(', 'col:val', '*', "it's", '(((', 'caching AND', '-x']) {
        expect(() => search(db, { query: q })).not.toThrow();
      }
      expect(() => search(db, { query: '   ' })).toThrow(UsageError);
    });
  });

  it('parses since values', () => {
    const now = new Date('2026-03-10T12:00:00.000Z');
    expect(parseSince('12h', now)).toBe('2026-03-10T00:00:00.000Z');
    expect(parseSince('7d', now)).toBe('2026-03-03T12:00:00.000Z');
    expect(parseSince('2w', now)).toBe('2026-02-24T12:00:00.000Z');
    expect(parseSince('2026-01-05')).toBe('2026-01-05');
    expect(() => parseSince('yesterday')).toThrow(UsageError);
  });
});

describe('sessions and show', () => {
  it('lists with sort options and limit', async () => {
    const m = await seeded();
    await withDb(m.ctx, (db) => {
      expect(listSessions(db).map((s) => s.id)).toEqual([S3, S2, S1]);
      expect(listSessions(db, { sort: 'length' })[0]?.id).toBe(S1);
      expect(listSessions(db, { sort: 'project' })).toHaveLength(3);
      expect(listSessions(db, { sort: 'source' })).toHaveLength(3);
      expect(listSessions(db, { limit: 2 })).toHaveLength(2);
      expect(listSessions(db, { project: 'other' }).map((s) => s.id)).toEqual([S2]);
      expect(listSessions(db, { since: '2026-02-02' })).toHaveLength(2);
      expect(listSessions(db, { machine: m.ctx.machineId })).toHaveLength(3);
      expect(listSessions(db).find((s) => s.id === S1)?.title).toBe('Caching chat');
    });
  });

  it('pages with offset in a stable order', async () => {
    const m = await seeded();
    await withDb(m.ctx, (db) => {
      const all = listSessions(db, { sort: 'time' }).map((s) => s.id);
      expect(all).toHaveLength(3);
      expect(listSessions(db, { sort: 'time', limit: 2 }).map((s) => s.id)).toEqual(all.slice(0, 2));
      expect(listSessions(db, { sort: 'time', limit: 2, offset: 2 }).map((s) => s.id)).toEqual(all.slice(2));
      expect(listSessions(db, { sort: 'time', offset: 3 })).toEqual([]);
    });
  });

  it('shows by prefix, hides thinking and tool output unless asked, and rejects ambiguity', async () => {
    const m = await seeded();
    await withDb(m.ctx, (db) => {
      const plain = getSession(db, 'aaaaaaaa-1');
      expect(plain.events.map((e) => e.kind)).toEqual(['text', 'text', 'tool']);
      expect(plain.events[2]?.content).toBe('cachekey');
      expect(plain.events[2]?.tool_output).toBeUndefined();
      const full = getSession(db, S1, { thinking: true, expandTools: true });
      expect(full.events.map((e) => e.kind)).toEqual(['text', 'thinking', 'text', 'tool']);
      expect(full.events[3]?.content).toContain('three matches found');
      expect(full.events[3]?.tool_output).toContain('three matches found');
      expect(() => getSession(db, 'aaaaaaaa')).toThrow(/ambiguous.*2 sessions/);
      expect(() => getSession(db, 'zzzz')).toThrow(NotFoundError);
      expect(() => getSession(db, "a'; drop")).toThrow(NotFoundError);
    });
  });
});

describe('exclusions', () => {
  it('matches globs case-insensitively across slash styles', () => {
    expect(matchesGlob('/home/alice/projects/demo', '**/projects/demo')).toBe(true);
    expect(matchesGlob('/home/alice/projects/demo', '/HOME/*/projects/*')).toBe(true);
    expect(matchesGlob('/home/alice/projects/demo/sub', '/home/*/projects/*')).toBe(false);
    expect(matchesGlob(FIXTURE_PROJECT_WINDOWS, 'c:/users/alice/**')).toBe(true);
    expect(matchesGlob('/a/b', '/a/?')).toBe(true);
    expect(matchesGlob('/a/bc', '/a/?')).toBe(false);
    expect(matchesGlob('/a.b', '/a.b')).toBe(true);
    expect(matchesGlob('/aXb', '/a.b')).toBe(false);
  });

  it('treats a trailing /** as the directory and everything below it', () => {
    expect(matchesGlob('/x/secret', '/x/secret/**')).toBe(true);
    expect(matchesGlob('/x/secret/', '/x/secret/**')).toBe(true);
    expect(matchesGlob('/x/secret/a/b', '/x/secret/**')).toBe(true);
    expect(matchesGlob('/x/secretive', '/x/secret/**')).toBe(false);
    expect(matchesGlob('/x', '/x/secret/**')).toBe(false);
    expect(matchesGlob('C:\\x\\secret', 'C:\\x\\secret\\**')).toBe(true);
    expect(matchesGlob('C:\\x\\Secret\\deep\\er', 'c:/x/secret/**')).toBe(true);
    expect(matchesGlob('/x/secret/a', '/x/secret/*')).toBe(true);
    expect(matchesGlob('/x/secret', '/x/secret/*')).toBe(false);
  });

  it('keeps a leading **/ pattern exact', () => {
    expect(matchesGlob('/a/projects/secret', '**/projects/secret')).toBe(true);
    expect(matchesGlob('/a/projects/secret/sub', '**/projects/secret')).toBe(false);
  });

  it('hides excluded sessions everywhere and add/remove recompute flags', async () => {
    const m = await seeded();
    await withDb(m.ctx, (db) => {
      expect(changeExclusion(m.ctx, db, 'add', { kind: 'project', value: '**/projects/other' })).toBe(true);
      expect(changeExclusion(m.ctx, db, 'add', { kind: 'project', value: '**/projects/other' })).toBe(false);
      expect(search(db, { query: 'beta' })).toHaveLength(0);
      expect(listSessions(db).map((s) => s.id)).not.toContain(S2);
      expect(() => getSession(db, S2)).toThrow('session not found');

      changeExclusion(m.ctx, db, 'add', { kind: 'session', value: S1 });
      expect(search(db, { query: 'caching' })).toHaveLength(0);
      expect(() => getSession(db, S1)).toThrow(NotFoundError);
      expect(listSessions(db).map((s) => s.id)).toEqual([S3]);

      changeExclusion(m.ctx, db, 'remove', { kind: 'project', value: '**/projects/other' });
      changeExclusion(m.ctx, db, 'remove', { kind: 'session', value: S1 });
      expect(listSessions(db)).toHaveLength(3);
      expect(readExclusions(m.ctx)).toEqual({ projectGlobs: [], sessionIds: [] });
      expect(() => changeExclusion(m.ctx, db, 'add', { kind: 'project', value: ' ' })).toThrow();
    });
  });

  it('flags excluded sessions on ingest and rebuild, and any seen project dir counts', async () => {
    const m = makeMachine();
    writeExclusions(m.ctx, { projectGlobs: ['**/projects/other'], sessionIds: [] });
    writeSession(
      m.claudeRoot,
      S1,
      userText(at(S1, 1), 'first in demo') + userText(at(S1, 2, '/home/alice/projects/other'), 'then moved elsewhere'),
    );
    await ingestAll(m.ctx);
    await withDb(m.ctx, (db) => {
      expect(search(db, { query: 'first' })).toHaveLength(0);
      applyExclusions(db, { projectGlobs: [], sessionIds: [] });
      expect(search(db, { query: 'first' })).toHaveLength(1);
    });
    await rebuild(m.ctx);
    await withDb(m.ctx, (db) => expect(search(db, { query: 'first' })).toHaveLength(0));
  });

  it('never matches a null project dir with globs', async () => {
    const m = makeMachine();
    await withDb(m.ctx, (db) => {
      db.prepare("insert into sessions (id, source, machine_id) values ('x', 'claude-ai', 'm')").run();
      applyExclusions(db, { projectGlobs: ['**'], sessionIds: [] });
      expect(db.prepare('select excluded from sessions').get()).toEqual({ excluded: 0 });
    });
  });
});

describe('multi machine and rebuild', () => {
  const ids = (ctx: HansardContext) =>
    withDb(ctx, (db) => ({
      events: (db.prepare('select id from events order by id').all() as { id: string }[]).map((r) => r.id),
      sessions: (db.prepare('select id from sessions order by id').all() as { id: string }[]).map((r) => r.id),
    }));

  it('two machines sharing one archive converge, also after rebuild', async () => {
    const archiveRoot = path.join(tempDir(), 'shared-archive');
    const a = makeMachine({ archiveRoot });
    const b = makeMachine({ archiveRoot });
    expect(a.ctx.machineId).not.toBe(b.ctx.machineId);
    writeSession(a.claudeRoot, S1, userText(at(S1, 1), 'from machine a') + assistant(at(S1, 2), [{ type: 'text', text: 'reply a' }]));
    writeSession(b.claudeRoot, S2, userText(at(S2, 2), 'from machine b'));
    await ingestAll(a.ctx);
    await ingestAll(b.ctx);
    await ingestAll(a.ctx);
    const [ia, ib] = [await ids(a.ctx), await ids(b.ctx)];
    expect(ia.events).toHaveLength(3);
    expect(ia).toEqual(ib);
    await rebuild(a.ctx);
    await rebuild(b.ctx);
    expect(await ids(a.ctx)).toEqual(ia);
    expect(await ids(b.ctx)).toEqual(ib);
    await withDb(b.ctx, (db) => {
      const summary = machineSummary(b.ctx, db);
      expect(summary.map((s) => s.sessions).sort()).toEqual([1, 1]);
      expect(summary.find((s) => s.current)?.id).toBe(b.ctx.machineId);
    });
  });

  it('rebuild keeps decisions and their event ids still resolve', async () => {
    const m = await seeded();
    const eventId = await withDb(m.ctx, (db) => {
      const id = (db.prepare("select id from events where kind = 'text' limit 1").get() as { id: string }).id;
      db.prepare("insert into decisions (id, session_id, event_id, statement, status) values ('d1', ?, ?, 'use sqlite', 'confirmed')").run(S1, id);
      return id;
    });
    const result = await rebuild(m.ctx);
    expect(result.sessions).toBe(3);
    await withDb(m.ctx, (db) => {
      const row = db
        .prepare('select e.id from decisions d join events e on e.id = d.event_id where d.id = ?')
        .get('d1') as { id: string } | undefined;
      expect(row?.id).toBe(eventId);
      expect(search(db, { query: 'caching' }).length).toBeGreaterThan(0);
    });
  });
});

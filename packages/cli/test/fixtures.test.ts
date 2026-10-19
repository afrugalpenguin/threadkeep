import { describe, expect, it } from 'vitest';
import { copyFixtures, sandbox, type Sandbox } from './helpers.js';

const fileLines = (out: string, status: string) => out.split('\n').filter((l) => l.startsWith(`${status}  `));
const lines = (out: string) => out.split('\n').filter((l) => l.length > 0);

const VACUUM = 'aaaaaaaa-0000-4000-8000-000000000001';
const KESTREL = 'aaaaaaaa-0000-4000-8000-000000000002';
const NOTES = 'aaaaaaaa-0000-4000-8000-000000000003';

async function ingested(): Promise<Sandbox> {
  const box = sandbox();
  copyFixtures(box);
  expect((await box.cli('ingest')).code).toBe(0);
  return box;
}

interface Hit {
  session_id: string;
  project_dir: string;
  timestamp: string;
  role: string;
  snippet: string;
}
const searchJson = async (box: Sandbox, ...args: string[]) => {
  const r = await box.cli('search', ...args, '--json');
  expect(r.code).toBe(0);
  return JSON.parse(r.out) as Hit[];
};
const sessionIds = (hits: Hit[]) => [...new Set(hits.map((h) => h.session_id))].sort();

describe('ingest output on the fixture sessions', () => {
  it('lists each ingested file and a scan summary, then reports everything unchanged on a rerun', async () => {
    const box = sandbox();
    copyFixtures(box);

    const first = await box.cli('ingest');
    expect(first.code).toBe(0);
    expect(first.out).toContain('scanned 3 source files, 3 archive files: 3 ingested, 0 unchanged, 0 skipped, 0 failed');
    const ingested = fileLines(first.out, 'ingested');
    expect(ingested).toHaveLength(3);
    expect(ingested.join('\n')).toContain('aaaaaaaa-0000-4000-8000-000000000002.jsonl  +5 events  +8 records');
    expect(first.out + first.err).not.toContain(box.base);

    const again = await box.cli('ingest');
    expect(again.code).toBe(0);
    expect(again.out).toContain('3 archive files: 0 ingested, 3 unchanged, 0 skipped, 0 failed');
    expect(fileLines(again.out, 'ingested')).toEqual([]);
    expect(fileLines(again.out, 'unchanged')).toEqual([]);

    const verbose = await box.cli('ingest', '--verbose');
    expect(fileLines(verbose.out, 'unchanged')).toHaveLength(3);
  });
});

describe('search on the fixture sessions', () => {
  it('prints ranked hits with time, session, role, project and a highlighted snippet', async () => {
    const box = await ingested();
    const r = await box.cli('search', 'kestrel');
    expect(r.code).toBe(0);
    const hits = lines(r.out);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const hit of hits) expect(hit).toMatch(/^2026-03-09 14:00 {2}aaaaaaaa {2}(user|assistant) {2}demo {2}.*\[kestrel\]/i);

    const json = await searchJson(box, 'kestrel');
    expect(sessionIds(json)).toEqual([KESTREL]);
    expect(json[0]).toMatchObject({ project_dir: '/home/alice/projects/demo' });
    expect(json[0]?.timestamp).toMatch(/^2026-03-09T/);
  });

  it('filters by project', async () => {
    const box = await ingested();
    expect(sessionIds(await searchJson(box, 'the'))).toEqual([VACUUM, KESTREL, NOTES]);
    expect(sessionIds(await searchJson(box, 'the', '--project', 'notes'))).toEqual([NOTES]);
    expect(sessionIds(await searchJson(box, 'the', '--project', 'demo'))).toEqual([VACUUM, KESTREL]);
  });

  it('filters by a date range, and a bare --until date includes that whole day', async () => {
    const box = await ingested();
    expect(sessionIds(await searchJson(box, 'the', '--since', '2026-03-05', '--until', '2026-03-09'))).toEqual([KESTREL]);
    expect(sessionIds(await searchJson(box, 'the', '--until', '2026-03-08'))).toEqual([VACUUM]);
    expect(sessionIds(await searchJson(box, 'the', '--since', '2026-03-10'))).toEqual([NOTES]);
    expect((await box.cli('search', 'the', '--until', 'someday')).code).toBe(2);
  });

  it('finds tool output and never indexes subagent files', async () => {
    const box = await ingested();
    expect(sessionIds(await searchJson(box, 'process.exit'))).toEqual([KESTREL]);
    expect(await searchJson(box, 'zanzibar')).toEqual([]);
  });
});

describe('sessions and show on the fixture sessions', () => {
  it('lists sessions newest first and filters by project and date range', async () => {
    const box = await ingested();
    const all = lines((await box.cli('sessions')).out);
    expect(all.map((l) => l.slice(0, 16))).toEqual(['2026-03-16 16:30', '2026-03-09 14:00', '2026-03-02 09:15']);
    expect(all[1]).toContain('Kestrel worker drops jobs on restart');
    expect(lines((await box.cli('sessions', '--project', 'demo')).out)).toHaveLength(2);
    const ranged = lines((await box.cli('sessions', '--since', '2026-03-05', '--until', '2026-03-10')).out);
    expect(ranged).toHaveLength(1);
    expect(ranged[0]).toContain('Kestrel');
  });

  it('replays a session with one line per tool call, and expands tools on request', async () => {
    const box = await ingested();
    const plain = await box.cli('show', KESTREL);
    expect(plain.code).toBe(0);
    expect(plain.out).toContain('title: Kestrel worker drops jobs on restart');
    expect(plain.out).toContain('[2026-03-09 14:00] user\n  Why does the kestrel worker drop jobs on restart?');
    expect(plain.out).toContain('[2026-03-09 14:00] tool Read: /home/alice/projects/demo/src/worker.ts\n');
    expect(plain.out).not.toContain('process.exit(0)');

    const expanded = await box.cli('show', KESTREL, '--expand-tools');
    expect(expanded.out).toContain('process.exit(0)');

    const vacuum = await box.cli('show', VACUUM);
    expect(vacuum.out).not.toContain('free pages behind');
    expect((await box.cli('show', VACUUM, '--thinking')).out).toContain('free pages behind');

    const ambiguous = await box.cli('show', 'aaaaaaaa');
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.err).toContain('ambiguous');
  });
});

describe('doctor on the fixture sessions', () => {
  it('reports archive size, session count and event count', async () => {
    const box = await ingested();
    const r = await box.cli('doctor');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^ok {4}archive size: [\d.]+ (B|KB|MB|GB) \(\d+ bytes\) in 4 files$/m);
    expect(r.out).toMatch(/^ok {4}contents: 3 sessions, 13 events$/m);
    expect(r.out).not.toContain(box.base);
  });

  it('reports an empty archive before the first ingest', async () => {
    const box = sandbox();
    const r = await box.cli('doctor');
    expect(r.out).toMatch(/^ok {4}contents: 0 sessions, 0 events$/m);
    expect(r.out).not.toMatch(/archive size/);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { sandbox, seed } from './helpers.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(50);
  }
}

describe('rebuild', () => {
  it('rebuilds from the archive only, without touching sources', async () => {
    const box = sandbox();
    seed(box, 2);
    await box.cli('ingest');
    fs.rmSync(box.claudeRoot, { recursive: true, force: true });
    const r = await box.cli('rebuild');
    expect(r.code).toBe(0);
    expect(r.out).toContain('rebuilt 2 sessions, 6 events, 8 records');
    expect((await box.cli('sessions')).out.trim().split('\n')).toHaveLength(2);
    expect((await box.cli('rebuild', 'x')).code).toBe(2);
  });
});

describe('exclusions', () => {
  it('lists, adds and removes by project glob and session id, hiding sessions', async () => {
    const box = sandbox();
    const [id] = seed(box, 2);
    await box.cli('ingest');
    expect((await box.cli('exclusions', 'list')).out).toContain('project globs (0)');

    expect((await box.cli('exclusions', 'add', '--project', '**/projects/demo')).out).toContain('added project');
    expect((await box.cli('sessions')).out).toBe('');
    expect((await box.cli('search', 'conversation')).out).toBe('');
    expect((await box.cli('show', id as string)).code).toBe(1);
    expect((await box.cli('exclusions', 'add', '--project', '**/projects/demo')).out).toContain('no change');
    expect((await box.cli('exclusions', 'list')).out).toContain('**/projects/demo');

    await box.cli('exclusions', 'remove', '--project', '**/projects/demo');
    expect((await box.cli('sessions')).out.trim().split('\n')).toHaveLength(2);
    await box.cli('exclusions', 'add', '--session', id as string);
    expect((await box.cli('sessions')).out.trim().split('\n')).toHaveLength(1);
    const shown = await box.cli('show', id as string);
    expect(shown.code).toBe(1);
    expect(shown.err).toContain('session not found');
    await box.cli('exclusions', 'remove', '--session', id as string);
    expect((await box.cli('sessions')).out.trim().split('\n')).toHaveLength(2);
  });

  it('rejects malformed invocations with exit 2', async () => {
    const box = sandbox();
    expect((await box.cli('exclusions')).code).toBe(2);
    expect((await box.cli('exclusions', 'add')).code).toBe(2);
    expect((await box.cli('exclusions', 'add', '--project', 'a', '--session', 'b')).code).toBe(2);
    expect((await box.cli('exclusions', 'frob')).code).toBe(2);
  });
});

describe('sources and machine', () => {
  it('lists registered adapters with home-relative locations', async () => {
    const box = sandbox();
    const before = await box.cli('sources');
    expect(before.out).toMatch(/^claude-code {2}live {2}found yes {2}~\/\.claude\/projects$/m);
    expect(before.out).not.toContain(box.base);
    fs.rmSync(box.claudeRoot, { recursive: true, force: true });
    expect((await box.cli('sources')).out).toContain('found no');
    const json = JSON.parse((await box.cli('sources', '--json')).out) as { id: string }[];
    expect(json.map((s) => s.id)).toContain('claude-code');
  });

  it('shows the machine and sets a label that reaches the archive and listings', async () => {
    const box = sandbox();
    seed(box, 1);
    const show = await box.cli('machine', 'show');
    expect(show.out).toMatch(/^id: [0-9a-f-]{36}$/m);
    expect(show.out).toContain('label: (none)');
    expect((await box.cli('machine', 'set-label', 'laptop')).code).toBe(0);
    expect((await box.cli('machine', 'show')).out).toContain('label: laptop');
    const machineFile = path.join(box.home, 'archive', 'machines');
    const files = fs.readdirSync(machineFile);
    expect(JSON.parse(fs.readFileSync(path.join(machineFile, files[0] as string), 'utf8'))).toMatchObject({ label: 'laptop' });
    await box.cli('ingest');
    expect((await box.cli('sessions')).out).toContain('  laptop  ');
    expect((await box.cli('sessions', '--machine', 'laptop')).out.trim().split('\n')).toHaveLength(1);
    expect((await box.cli('machine', 'set-label')).code).toBe(2);
    expect((await box.cli('machine', 'bogus')).code).toBe(2);
  });
});

describe('doctor', () => {
  it('reports ok and warn lines and exits 0 on a healthy setup', async () => {
    const box = sandbox();
    seed(box, 1);
    await box.cli('ingest');
    const r = await box.cli('doctor');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^ok {4}database: <home>\/history\.db schema version 2$/m);
    expect(r.out).toMatch(/^ok {4}archive: <archive> reachable and writable$/m);
    expect(r.out).toMatch(/^warn {2}hansard on PATH: not found$/m);
    expect(r.out).toMatch(/^warn {2}mcp server: not built yet$/m);
    expect(r.out).toMatch(/^ok {4}source claude-code: found$/m);
    expect(r.out).not.toContain(box.base);
  });

  it('exits 1 when a check fails', async () => {
    const box = sandbox();
    fs.mkdirSync(box.home, { recursive: true });
    fs.writeFileSync(path.join(box.home, 'archive'), 'not a directory');
    const r = await box.cli('doctor');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^fail {2}archive:/m);
  });
});

describe('watch', () => {
  it('ingests a session file when it changes and stops on abort', async () => {
    const box = sandbox();
    let out = '';
    let err = '';
    const controller = new AbortController();
    const done = run(
      ['watch', '--debounce', '100'],
      { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
      box.env,
      controller.signal,
    );
    await waitFor(() => out.includes('watching'));
    await sleep(300);
    seed(box, 1);
    await waitFor(() => out.includes('ingested ~'), 9000);
    expect(out).toMatch(/ingested ~\/\.claude\/projects\/.*\.jsonl: 3 new events/);
    expect(out + err).not.toContain(box.base);
    controller.abort();
    expect(await done).toBe(0);
    expect((await box.cli('sessions')).out.trim().split('\n')).toHaveLength(1);
  }, 20_000);
});

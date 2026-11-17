import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adapters } from '../packages/core/src/index.js';
import { run } from '../packages/cli/src/run.js';
import { assertSafeOutDir, fakeSecret, forbiddenDirs, makeFixtures } from '../scripts/make-fixtures.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function temp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'threadkeep-fixtures-test-'));
  dirs.push(dir);
  return dir;
}

const repoRoot = path.resolve(import.meta.dirname, '..');

async function cli(base: string, ...argv: string[]) {
  const env = { THREADKEEP_HOME: path.join(base, 'home'), HOME: path.join(base, 'user'), USERPROFILE: path.join(base, 'user') };
  let out = '';
  let err = '';
  const code = await run(argv, { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } }, env);
  return { code, out, err };
}

describe('make-fixtures', () => {
  it('generates a tree that ingests, imports, is idempotent and never leaks the planted secret', async () => {
    const base = temp();
    const data = path.join(base, 'data');
    const written = makeFixtures(data, adapters, { repoRoot, forbidden: [] });
    expect(written.map((w) => w.adapter)).toEqual(adapters.map((a) => a.id));

    // Point the claude-code source at the generated tree through the scratch home's config.
    const home = path.join(base, 'home');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      path.join(home, 'config.json'),
      JSON.stringify({ dbPath: '<home>/history.db', archiveRoot: '<home>/archive', sources: { 'claude-code': { root: path.join(data, 'claude-code') } } }),
    );

    const ingest = await cli(base, 'ingest');
    expect(ingest.code).toBe(0);
    expect(ingest.out).toContain('ingested 2 files');
    expect(ingest.err).toContain('unparseable line');

    const zip = path.join(data, 'claude-ai', 'export.zip');
    const imported = await cli(base, 'import', 'claude-ai', zip);
    expect(imported.code).toBe(0);
    expect(imported.out).toContain('imported 1 exports, 2 new conversations');

    const sessions = await cli(base, 'sessions');
    expect(sessions.out.trim().split('\n')).toHaveLength(4);
    expect(sessions.out).toContain('Demo conversation 1');
    expect(sessions.out).toContain('Demo conversation 2');

    const again = await cli(base, 'ingest');
    expect(again.out).toContain('0 new events');
    const importAgain = await cli(base, 'import', 'claude-ai', zip);
    expect(importAgain.out).toContain('0 new conversations');
    expect(importAgain.out).toContain('1 already imported');
    expect((await cli(base, 'sessions')).out.trim().split('\n')).toHaveLength(4);

    const secret = fakeSecret();
    for (const argv of [['search', 'deploy'], ['search', 'deploy', '--json'], ['sessions', '--json']]) {
      const result = await cli(base, ...argv);
      expect(result.code).toBe(0);
      expect(result.out).not.toContain(secret);
    }
    expect((await cli(base, 'search', 'deploy')).out).toContain('[REDACTED:anthropic]');
    expect(fs.readFileSync(path.join(data, 'claude-code', '-home-alice-projects-demo', '11111111-1111-4111-8111-111111111111.jsonl'), 'utf8')).toContain(secret);
  });

  it('refuses unsafe output directories and non-empty targets', () => {
    const base = temp();
    expect(() => assertSafeOutDir(path.join(repoRoot, 'out'), { repoRoot, forbidden: [] })).toThrow(/repository/);
    const fakeHome = path.join(base, 'user');
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
    for (const name of ['.claude', '.threadkeep']) {
      expect(() => assertSafeOutDir(path.join(fakeHome, name, 'x'), { repoRoot, forbidden: [path.join(fakeHome, '.claude'), path.join(fakeHome, '.threadkeep')] })).toThrow(/refusing/);
    }
    const full = path.join(base, 'full');
    fs.mkdirSync(full);
    fs.writeFileSync(path.join(full, 'keep.txt'), 'x');
    expect(() => assertSafeOutDir(full, { repoRoot, forbidden: [] })).toThrow(/not an empty directory/);
    expect(() => assertSafeOutDir(path.join(base, 'fresh'), { repoRoot, forbidden: [] })).not.toThrow();
  });
});

describe('guard path forms', () => {
  it('builds the forbidden list from homes and environment redirects', () => {
    const dirs = forbiddenDirs({ USERPROFILE: path.join(path.sep, 'u'), HOME: path.join(path.sep, 'h'), THREADKEEP_HOME: path.join(path.sep, 'hh'), CLAUDE_CONFIG_DIR: path.join(path.sep, 'cc') }, path.join(path.sep, 'o'));
    expect(dirs).toEqual([
      path.join(path.sep, 'o', '.claude'),
      path.join(path.sep, 'o', '.threadkeep'),
      path.join(path.sep, 'u', '.claude'),
      path.join(path.sep, 'u', '.threadkeep'),
      path.join(path.sep, 'h', '.claude'),
      path.join(path.sep, 'h', '.threadkeep'),
      path.join(path.sep, 'hh'),
      path.join(path.sep, 'cc'),
    ]);
    expect(forbiddenDirs({}, path.join(path.sep, 'o'))).toHaveLength(2);
  });

  it.runIf(process.platform === 'win32')('treats 8.3 short and long forms of a path as the same place', () => {
    const base = temp();
    const short = fs.realpathSync(base); // may keep an 8.3 component such as RUSSEL~1
    const long = fs.realpathSync.native(base);
    for (const [forbiddenRoot, targetRoot] of [[long, short], [short, long]] as const) {
      const fake = path.join(forbiddenRoot, 'user', '.claude');
      fs.mkdirSync(fake, { recursive: true });
      expect(() => assertSafeOutDir(path.join(targetRoot, 'user', '.claude', 'x'), { repoRoot, forbidden: [fake] })).toThrow(/refusing/);
    }
  });
});

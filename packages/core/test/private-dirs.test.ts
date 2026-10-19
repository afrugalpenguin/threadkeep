import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestAll, loadContext, openDb } from '../src/index.js';
import { makeMachine, tempDir, writeSession } from './helpers.js';
import { userText } from '../src/adapters/claude-code/fixtures.js';

const posix = process.platform !== 'win32';
const mode = (p: string): number => fs.statSync(p).mode & 0o777;

describe.skipIf(!posix)('private data dir (POSIX)', () => {
  it('creates the home, archive, database dir and config files owner-only', async () => {
    const base = tempDir();
    const home = path.join(base, 'a', 'b', 'hansard-home');
    const ctx = loadContext({ home, userHome: path.join(base, 'user'), env: {} });
    for (const dir of [path.join(base, 'a', 'b'), home]) expect(mode(dir) & 0o077, dir).toBe(0);
    for (const file of ['config.json', 'machine.json', 'exclusions.json']) expect(mode(path.join(home, file)), file).toBe(0o600);
    const m = makeMachine();
    writeSession(m.claudeRoot, 'eeeeeeee-1111-4111-8111-111111111111', userText({ sessionId: 'eeeeeeee-1111-4111-8111-111111111111', uuid: 'e1', timestamp: '2026-04-01T10:00:00.000Z' }, 'hello'));
    await ingestAll(m.ctx);
    openDb(m.ctx.dbPath).close();
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [path.join(dir, e.name), ...walk(path.join(dir, e.name))] : []));
    for (const dir of [m.ctx.home, ...walk(m.ctx.home)]) expect(mode(dir) & 0o077, dir).toBe(0);
    expect(ctx.home).toBe(home);
  });

  it('does not change the mode of an existing home', () => {
    const base = tempDir();
    const home = path.join(base, 'hansard-home');
    fs.mkdirSync(home, { mode: 0o755 });
    fs.chmodSync(home, 0o755);
    loadContext({ home, userHome: path.join(base, 'user'), env: {} });
    expect(mode(home)).toBe(0o755);
  });
});

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { BusyError, openDb, withLock } from '../src/index.js';
import { userText } from '../src/adapters/claude-code/fixtures.js';
import { appendSession, archiveSessionPath, makeMachine, sha256File, tempDir, writeSession } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.join(here, '..');
const SID = '44444444-4444-4444-8444-444444444444';

describe('lock ownership and heartbeat', () => {
  it('does not delete a lock that another run now owns, and warns', async () => {
    const { ctx } = makeMachine();
    const warnings: string[] = [];
    const foreign = `${process.pid} ${Date.now()} someone-elses-token\n`;
    await withLock(ctx, { waitMs: 0, onWarning: (w) => warnings.push(w) }, () => {
      fs.writeFileSync(ctx.lockPath, foreign);
    });
    expect(fs.readFileSync(ctx.lockPath, 'utf8')).toBe(foreign);
    expect(warnings).toEqual(['lock was taken over by another run']);
  });

  it('keeps a long run alive by refreshing the lock file, so a waiter never sees it as stale', async () => {
    const { ctx } = makeMachine();
    await withLock(ctx, { waitMs: 0, heartbeatMs: 40 }, async () => {
      const old = new Date(Date.now() - 11 * 60 * 1000);
      fs.utimesSync(ctx.lockPath, old, old);
      await new Promise((r) => setTimeout(r, 150));
      expect(Date.now() - fs.statSync(ctx.lockPath).mtimeMs).toBeLessThan(5000);
      await expect(withLock(ctx, { waitMs: 250 }, () => 1)).rejects.toBeInstanceOf(BusyError);
    });
  });

  it('does not refresh a lock it no longer owns', async () => {
    const { ctx } = makeMachine();
    await withLock(ctx, { waitMs: 0, heartbeatMs: 40, onWarning: () => undefined }, async () => {
      fs.writeFileSync(ctx.lockPath, `${process.pid} ${Date.now()} other-token\n`);
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(ctx.lockPath, old, old);
      await new Promise((r) => setTimeout(r, 150));
      expect(Date.now() - fs.statSync(ctx.lockPath).mtimeMs).toBeGreaterThan(30_000);
    });
  });
});

const childScript = (distUrl: string) => `
import { loadContext, ingestFile } from ${JSON.stringify(distUrl)};
const [home, userHome, file, rounds] = process.argv.slice(2);
const ctx = loadContext({ home, userHome, env: {} });
for (let i = 0; i < Number(rounds); i += 1) await ingestFile(ctx, file, { waitMs: 30000 });
`;

function run(script: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', resolve);
  });
}

describe('two real processes', () => {
  beforeAll(() => {
    // The children import the built package; make sure it is current.
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    execFileSync(process.execPath, [tsc, '-b', coreDir]);
  }, 60_000);

  it('mirror a growing source to a byte identical archive with no duplicate rows', async () => {
    const m = makeMachine();
    const file = writeSession(m.claudeRoot, SID, userText({ sessionId: SID, uuid: 'u0', timestamp: '2026-01-01T10:00:00.000Z' }, 'first'));
    const script = path.join(tempDir(), 'child.mjs');
    fs.writeFileSync(script, childScript(pathToFileURL(path.join(coreDir, 'dist', 'index.js')).href));
    const args = [m.ctx.home, m.userHome, file, '6'];
    const children = [run(script, args), run(script, args)];
    for (let n = 1; n <= 12; n += 1) {
      appendSession(file, userText({ sessionId: SID, uuid: `u${n}`, timestamp: `2026-01-01T10:00:${String(n).padStart(2, '0')}.000Z` }, `line ${n}`));
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(await Promise.all(children)).toEqual([0, 0]);
    await run(script, [m.ctx.home, m.userHome, file, '1']);
    expect(sha256File(archiveSessionPath(m.ctx, SID))).toBe(sha256File(file));
    const db = openDb(m.ctx.dbPath);
    expect(db.prepare('select count(*) as n from raw_records').get()).toEqual({ n: 13 });
    expect(db.prepare('select count(*) as n from events').get()).toEqual({ n: 13 });
    db.close();
  }, 60_000);
});

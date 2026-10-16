import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ingestAll, safeMessage } from '../src/index.js';
import { claudeCodeAdapter } from '../src/adapters/claude-code/index.js';
import { userText } from '../src/adapters/claude-code/fixtures.js';
import { makeMachine, writeSession } from './helpers.js';

const SID = '66666666-6666-4666-8666-666666666666';

afterEach(() => vi.restoreAllMocks());

describe('safeMessage', () => {
  it('prints errno errors as code, syscall and a display path', () => {
    const m = makeMachine();
    fs.writeFileSync(m.ctx.archiveRoot, 'a file where a directory should be');
    let caught: unknown;
    try {
      fs.mkdirSync(m.ctx.archiveRoot);
    } catch (error) {
      caught = error;
    }
    const text = safeMessage(m.ctx, caught);
    expect(text).toBe('EEXIST mkdir <archive>');
    expect((caught as Error).message).toContain(m.ctx.archiveRoot);
  });

  it('replaces home, user home and archive roots in other messages', () => {
    const m = makeMachine();
    const error = new Error(`bad ${m.ctx.home} and ${m.ctx.archiveRoot}/x and ${m.userHome}`);
    expect(safeMessage(m.ctx, error)).toBe('bad <home> and <archive>/x and ~');
    expect(safeMessage(m.ctx, 'nope')).toBe('unknown failure');
  });

  it('an archive path that is a file fails ingest with no absolute path in the message', async () => {
    const m = makeMachine();
    fs.writeFileSync(m.ctx.archiveRoot, 'not a directory');
    const error = await ingestAll(m.ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const text = safeMessage(m.ctx, error);
    expect(text).not.toContain(path.dirname(m.ctx.home));
    expect(text).toMatch(/^E[A-Z]+ /);
  });
});

describe('unreadable directories', () => {
  it('become a skip warning with a relative path instead of aborting the run', async () => {
    const m = makeMachine();
    writeSession(m.claudeRoot, SID, userText({ sessionId: SID, uuid: 'u1', timestamp: '2026-01-01T10:00:00.000Z' }, 'ok'));
    writeSession(m.claudeRoot, '77777777-7777-4777-8777-777777777777', userText({ sessionId: '77777777-7777-4777-8777-777777777777', uuid: 'u1', timestamp: '2026-01-01T10:00:00.000Z' }, 'hidden'), '-locked-project');
    const real = fs.readdirSync;
    vi.spyOn(fs, 'readdirSync').mockImplementation(((dir: fs.PathLike, ...rest: unknown[]) => {
      if (String(dir).endsWith('-locked-project')) throw Object.assign(new Error(`EACCES ${String(dir)}`), { code: 'EACCES' });
      return (real as (...a: unknown[]) => unknown)(dir, ...rest);
    }) as typeof fs.readdirSync);
    const result = await ingestAll(m.ctx);
    expect(result.warnings).toContain('-locked-project: unreadable directory, skipped');
    expect(result.newEvents).toBe(1);
  });
});

describe('adapter listing', () => {
  it('reports an unreadable archive directory through the warning callback', () => {
    const m = makeMachine();
    const base = path.join(m.ctx.archiveRoot, 'raw', 'claude-code');
    fs.mkdirSync(path.join(base, 'machine-1', 'proj'), { recursive: true });
    const real = fs.readdirSync;
    vi.spyOn(fs, 'readdirSync').mockImplementation(((dir: fs.PathLike, ...rest: unknown[]) => {
      if (String(dir).endsWith('proj')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return (real as (...a: unknown[]) => unknown)(dir, ...rest);
    }) as typeof fs.readdirSync);
    const warnings: string[] = [];
    expect(claudeCodeAdapter.archiveFiles(m.ctx, (w) => warnings.push(w))).toEqual([]);
    expect(warnings).toEqual(['raw/claude-code/machine-1/proj: unreadable directory, skipped']);
  });
});

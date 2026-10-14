import fs from 'node:fs';
import type { HansardContext } from './config.js';

export class BusyError extends Error {
  constructor() {
    super('busy: another hansard run holds the ingest lock');
    this.name = 'BusyError';
  }
}

const STALE_MS = 10 * 60 * 1000;
const POLL_MS = 200;

interface LockInfo {
  pid: number;
  at: number;
}

function readLock(lockPath: string): LockInfo | null {
  try {
    const [pid, at] = fs.readFileSync(lockPath, 'utf8').trim().split(/\s+/).map(Number);
    if (Number.isFinite(pid) && Number.isFinite(at)) return { pid: pid as number, at: at as number };
  } catch {
    // unreadable or half written: treated as unknown, not stale
  }
  return null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isStale(info: LockInfo | null, lockPath: string): boolean {
  if (info) return !pidAlive(info.pid) || Date.now() - info.at > STALE_MS;
  // A lock with no readable content is only stale once it is old.
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs > STALE_MS;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface LockOptions {
  waitMs?: number;
  onWarning?: (message: string) => void;
}

// Held for every mirror, ingest and rebuild so concurrent runs cannot double-append to the archive.
export async function withLock<T>(ctx: HansardContext, options: LockOptions, fn: () => Promise<T> | T): Promise<T> {
  const deadline = Date.now() + (options.waitMs ?? 30_000);
  for (;;) {
    try {
      const fd = fs.openSync(ctx.lockPath, 'wx');
      fs.writeSync(fd, `${process.pid} ${Date.now()}\n`);
      fs.closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = readLock(ctx.lockPath);
    if (isStale(info, ctx.lockPath)) {
      // Rename rather than unlink so only one waiter wins the take-over.
      const aside = `${ctx.lockPath}.stale-${process.pid}-${Date.now()}`;
      try {
        const again = readLock(ctx.lockPath);
        if (again?.pid === info?.pid && again?.at === info?.at) {
          fs.renameSync(ctx.lockPath, aside);
          fs.rmSync(aside, { force: true });
          options.onWarning?.('took over a stale ingest lock');
        }
      } catch {
        // another waiter took it over first
      }
      continue;
    }
    if (Date.now() >= deadline) throw new BusyError();
    await sleep(POLL_MS);
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(ctx.lockPath, { force: true });
  }
}

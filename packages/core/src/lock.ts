import { randomUUID } from 'node:crypto';
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
const HEARTBEAT_MS = 60 * 1000;

function readRaw(lockPath: string): string | null {
  try {
    return fs.readFileSync(lockPath, 'utf8');
  } catch {
    return null;
  }
}

const parts = (raw: string | null): { pid: number; token: string } | null => {
  if (raw === null) return null;
  const [pid, , token] = raw.trim().split(/\s+/);
  return Number.isFinite(Number(pid)) ? { pid: Number(pid), token: token ?? '' } : null;
};

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Stale means the holder is gone, or it stopped refreshing the lock file (a live holder touches it every minute).
function isStale(raw: string | null, lockPath: string): boolean {
  const info = parts(raw);
  if (info && !pidAlive(info.pid)) return true;
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
  // Heartbeat interval, shortened by tests.
  heartbeatMs?: number;
}

// Rename the stale lock aside, then confirm it is what we judged. If a fresh lock slipped in between our
// check and the rename, put it back and keep waiting.
function takeOver(lockPath: string, judged: string, warn: ((m: string) => void) | undefined): void {
  const aside = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    fs.renameSync(lockPath, aside);
  } catch {
    return; // another waiter took it over first
  }
  if (readRaw(aside) === judged) {
    fs.rmSync(aside, { force: true });
    warn?.('took over a stale ingest lock');
    return;
  }
  try {
    fs.linkSync(aside, lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  fs.rmSync(aside, { force: true });
}

// Held for every mirror, ingest and rebuild so concurrent runs cannot double-append to the archive.
export async function withLock<T>(ctx: HansardContext, options: LockOptions, fn: () => Promise<T> | T): Promise<T> {
  const deadline = Date.now() + (options.waitMs ?? 30_000);
  const token = randomUUID();
  for (;;) {
    try {
      const fd = fs.openSync(ctx.lockPath, 'wx');
      fs.writeSync(fd, `${process.pid} ${Date.now()} ${token}\n`);
      fs.closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const raw = readRaw(ctx.lockPath);
    if (raw !== null && isStale(raw, ctx.lockPath)) {
      takeOver(ctx.lockPath, raw, options.onWarning);
      continue;
    }
    if (Date.now() >= deadline) throw new BusyError();
    await sleep(POLL_MS);
  }

  const ours = () => parts(readRaw(ctx.lockPath))?.token === token;
  const heartbeat = setInterval(() => {
    if (!ours()) return;
    try {
      const now = new Date();
      fs.utimesSync(ctx.lockPath, now, now);
    } catch {
      // the lock vanished; release will report it
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref();
  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    if (ours()) fs.rmSync(ctx.lockPath, { force: true });
    else options.onWarning?.('lock was taken over by another run');
  }
}

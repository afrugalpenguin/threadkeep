import fs from 'node:fs';
import path from 'node:path';

const BACKSLASH = String.fromCharCode(92);

export function toPosix(p: string): string {
  return p.split(BACKSLASH).join('/');
}

// Relative path of child under parent ('' when equal), or null when child is outside parent.
export function relativeWithin(parent: string, child: string): string | null {
  const a = path.resolve(parent);
  const b = path.resolve(child);
  const cmpA = process.platform === 'win32' ? a.toLowerCase() : a;
  const cmpB = process.platform === 'win32' ? b.toLowerCase() : b;
  const rel = path.relative(cmpA, cmpB);
  if (rel === '') return '';
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return toPosix(path.relative(a, b));
}

export function expandHome(p: string, userHome: string): string {
  if (p === '~') return userHome;
  if (p.startsWith('~/') || p.startsWith(`~${BACKSLASH}`)) return path.join(userHome, p.slice(2));
  return p;
}

export function basename(p: string): string {
  const parts = toPosix(p).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

// Owner-only on POSIX (mode applies to every directory this call creates, never to existing ones).
// Windows keeps the per-user ACLs of the profile, so no mode is passed there.
export function mkdirPrivate(dir: string): void {
  fs.mkdirSync(dir, process.platform === 'win32' ? { recursive: true } : { recursive: true, mode: 0o700 });
}

export const PRIVATE_FILE_MODE = process.platform === 'win32' ? undefined : 0o600;

import path from 'node:path';
import { displayPath, type PathRoots } from './config.js';
import { toPosix } from './paths.js';

const replaceAll = (text: string, needle: string, to: string) => (needle ? text.split(needle).join(to) : text);

// An error message that is safe to print or log: no absolute home, user or archive paths.
export function safeMessage(roots: PathRoots, error: unknown): string {
  if (!(error instanceof Error)) return 'unknown failure';
  const errno = error as NodeJS.ErrnoException;
  if (typeof errno.code === 'string' && typeof errno.syscall === 'string') {
    const where = typeof errno.path === 'string' ? ` ${displayPath(roots, path.resolve(errno.path))}` : '';
    return `${errno.code} ${errno.syscall}${where}`;
  }
  let text = error.message;
  const targets: [string | undefined, string][] = [
    [roots.archiveRoot, '<archive>'],
    [roots.home, '<home>'],
    [roots.userHome, '~'],
  ];
  for (const [root, shown] of targets) {
    if (!root) continue;
    for (const form of new Set([root, toPosix(root), path.resolve(root)])) text = replaceAll(text, form, shown);
  }
  return text;
}

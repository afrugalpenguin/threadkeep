import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { loadContext, type HansardContext, type LoadContextOptions } from '../src/index.js';

const dirs: string[] = [];

export function tempDir(prefix = 'hansard-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

// A machine whose data dir and fake "user home" both live in temp dirs. Pass archiveRoot to share one archive.
export function makeMachine(options: { archiveRoot?: string; label?: string } = {}): {
  ctx: HansardContext;
  userHome: string;
  claudeRoot: string;
} {
  const base = tempDir();
  const userHome = path.join(base, 'user');
  const home = path.join(base, 'hansard-home');
  const claudeRoot = path.join(userHome, '.claude', 'projects');
  fs.mkdirSync(claudeRoot, { recursive: true });
  const loadOptions: LoadContextOptions = { home, userHome, env: {} };
  if (options.archiveRoot) loadOptions.overrides = { archiveRoot: options.archiveRoot };
  const ctx = loadContext(loadOptions);
  return { ctx, userHome, claudeRoot };
}

import { createHash } from 'node:crypto';
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

export interface Machine {
  ctx: HansardContext;
  userHome: string;
  claudeRoot: string;
}

// A machine whose data dir and fake "user home" both live in temp dirs. Pass archiveRoot to share one archive.
export function makeMachine(options: { archiveRoot?: string } = {}): Machine {
  const base = tempDir();
  const userHome = path.join(base, 'user');
  const home = path.join(base, 'hansard-home');
  const claudeRoot = path.join(userHome, '.claude', 'projects');
  fs.mkdirSync(claudeRoot, { recursive: true });
  const loadOptions: LoadContextOptions = { home, userHome, env: {} };
  if (options.archiveRoot) loadOptions.overrides = { archiveRoot: options.archiveRoot };
  return { ctx: loadContext(loadOptions), userHome, claudeRoot };
}

export const FIXTURE_FOLDER = '-home-alice-projects-demo';

export function sessionPath(claudeRoot: string, sessionId: string, folder = FIXTURE_FOLDER): string {
  return path.join(claudeRoot, folder, `${sessionId}.jsonl`);
}

export function writeSession(claudeRoot: string, sessionId: string, text: string, folder?: string): string {
  const file = sessionPath(claudeRoot, sessionId, folder);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

export function appendSession(file: string, text: string): void {
  fs.appendFileSync(file, text);
}

export function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function archiveSessionPath(ctx: HansardContext, sessionId: string, folder = FIXTURE_FOLDER): string {
  return path.join(ctx.archiveRoot, 'raw', 'claude-code', ctx.machineId, folder, `${sessionId}.jsonl`);
}

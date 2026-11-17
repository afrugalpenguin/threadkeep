import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { getAdapter } from 'threadkeep-core';
import { run } from '../src/run.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

export interface Sandbox {
  base: string;
  home: string;
  userHome: string;
  claudeRoot: string;
  env: Record<string, string>;
  cli(...argv: string[]): Promise<{ code: number; out: string; err: string }>;
}

// Everything lives under one temp dir; the real home directory is never consulted.
export function sandbox(): Sandbox {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'threadkeep-cli-test-'));
  dirs.push(base);
  const userHome = path.join(base, 'user');
  const home = path.join(base, 'threadkeep-home');
  const claudeRoot = path.join(userHome, '.claude', 'projects');
  fs.mkdirSync(claudeRoot, { recursive: true });
  const env = { THREADKEEP_HOME: home, HOME: userHome, USERPROFILE: userHome };
  return {
    base,
    home,
    userHome,
    claudeRoot,
    env,
    async cli(...argv) {
      let out = '';
      let err = '';
      const code = await run(argv, { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } }, env);
      return { code, out, err };
    },
  };
}

export function seed(box: Sandbox, sessions = 2): string[] {
  const adapter = getAdapter('claude-code');
  if (!adapter) throw new Error('claude-code adapter missing');
  return adapter.fixtures.generate({ root: box.claudeRoot, sessions }).sessionIds;
}

// The hand-written synthetic sessions in tests/fixtures/claude-code, copied in as ~/.claude/projects.
export const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tests', 'fixtures', 'claude-code');

export function copyFixtures(box: Sandbox): void {
  fs.cpSync(FIXTURE_ROOT, box.claudeRoot, { recursive: true });
}

export const sleep =(ms: number) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(check: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(50);
  }
}

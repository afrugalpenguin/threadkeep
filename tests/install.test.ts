import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SHIM_MARKER, shimFiles, writeShims } from '../scripts/install.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'threadkeep-install-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('install shims', () => {
  it('writes a cmd and a sh launcher on Windows and only a sh launcher elsewhere', () => {
    const entry = path.join('repo', 'packages', 'cli', 'dist', 'index.js');
    const win = shimFiles(entry, 'win32');
    expect(Object.keys(win).sort()).toEqual(['threadkeep', 'threadkeep.cmd']);
    expect(win['threadkeep.cmd']).toContain(`node "${entry}" %*`);
    expect(Object.keys(shimFiles(entry, 'linux'))).toEqual(['threadkeep']);
    for (const text of Object.values(win)) expect(text).toContain(SHIM_MARKER);
    expect(shimFiles(entry, 'linux')['threadkeep']).toContain(`exec node "${entry}" "$@"`);
  });

  it('writes the launchers, rewrites its own on a rerun, and refuses to replace anything else', () => {
    const bin = tempDir();
    const entry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
    expect(writeShims(bin, entry, 'linux')).toEqual({ written: ['threadkeep'], refused: [] });
    expect(writeShims(bin, entry, 'linux')).toEqual({ written: ['threadkeep'], refused: [] });

    const other = tempDir();
    fs.writeFileSync(path.join(other, 'threadkeep'), '#!/bin/sh\necho someone else\n');
    expect(writeShims(other, entry, 'linux')).toEqual({ written: [], refused: ['threadkeep'] });
    expect(fs.readFileSync(path.join(other, 'threadkeep'), 'utf8')).toContain('someone else');
  });

  it.runIf(process.platform === 'win32' && fs.existsSync(path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js')))(
    'produces a cmd launcher that runs the built cli',
    () => {
      const bin = tempDir();
      writeShims(bin, path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js'), 'win32');
      const out = execFileSync(path.join(bin, 'threadkeep.cmd'), ['--help'], { encoding: 'utf8', shell: true });
      expect(out).toContain('usage: threadkeep <command>');
    },
  );
});

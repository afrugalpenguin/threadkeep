#!/usr/bin/env node
// One-command install from a checkout: installs dependencies from the lockfile, builds every
// package and puts a `threadkeep` launcher in npm's global bin directory, which npm already keeps on PATH.
//
//   node scripts/install.mjs            install, build and write the launcher
//   node scripts/install.mjs --no-link  install and build only
//
// The launcher only runs packages/cli/dist/index.js from this checkout; delete it to uninstall.
// An existing `threadkeep` launcher that this script did not write is never replaced.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHIM_MARKER = 'threadkeep launcher written by scripts/install.mjs';

export function shimFiles(cliEntry, platform) {
  const sh = `#!/bin/sh\n# ${SHIM_MARKER}\nexec node "${cliEntry}" "$@"\n`;
  if (platform !== 'win32') return { threadkeep: sh };
  // Git Bash on Windows uses the sh launcher; cmd and PowerShell use the .cmd one.
  return { 'threadkeep.cmd': `@echo off\r\nrem ${SHIM_MARKER}\r\nnode "${cliEntry}" %*\r\n`, threadkeep: sh };
}

export function writeShims(binDir, cliEntry, platform = process.platform) {
  const written = [];
  const refused = [];
  for (const [name, text] of Object.entries(shimFiles(cliEntry, platform))) {
    const target = path.join(binDir, name);
    if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes(SHIM_MARKER)) {
      refused.push(name);
      continue;
    }
    fs.writeFileSync(target, text, { mode: 0o755 });
    written.push(name);
  }
  return { written, refused };
}

// pnpm on PATH, else the one corepack ships with Node.
function findPnpm() {
  for (const cmd of [['pnpm'], ['corepack', 'pnpm']]) {
    const r = spawnSync(cmd[0], [...cmd.slice(1), '--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status === 0) return cmd;
  }
  return null;
}

function npmBinDir() {
  const prefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
  return process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
}

function main() {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const link = !process.argv.includes('--no-link');
  if (Number(process.versions.node.split('.')[0]) < 22) {
    console.error(`install: Node 22 or newer is required, this is ${process.versions.node}`);
    process.exit(1);
  }
  const pnpm = findPnpm();
  if (!pnpm) {
    console.error('install: pnpm not found. Run `corepack enable` or `npm install -g pnpm`, then retry.');
    process.exit(1);
  }
  const step = (label, args) => {
    console.log(`install: ${label}`);
    const r = spawnSync(pnpm[0], [...pnpm.slice(1), ...args], { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) {
      console.error(`install: ${label} failed`);
      process.exit(1);
    }
  };
  step('installing dependencies from the lockfile', ['install', '--frozen-lockfile']);
  step('building', ['-r', 'build']);
  if (!link) return;

  const bin = npmBinDir();
  const { written, refused } = writeShims(bin, path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js'));
  for (const name of written) console.log(`install: wrote ${path.join(bin, name)}`);
  if (refused.length > 0) {
    for (const name of refused) console.error(`install: ${path.join(bin, name)} exists and was not written by this script, left alone`);
    process.exit(1);
  }
  console.log('install: done. Next: threadkeep ingest');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

// Writes synthetic demo data for every registered adapter into an empty directory.
//
//   pnpm build
//   pnpm fixtures <dir>
//
// Everything is hard-coded placeholder content (user "alice", project "/home/alice/projects/demo").
// Nothing is read from any real data. The one fake secret is assembled here at run time so no
// credential-shaped text sits in the repository.
//
// Run with Node's built-in type stripping against the built packages, so no extra tooling is needed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface SampleAdapter {
  id: string;
  fixtures: { sample(opts: { root: string; secret: string }): { files: string[] } };
}

export interface Guards {
  repoRoot: string;
  // Directories that must never be written into, such as the real .claude and .threadkeep.
  forbidden: string[];
}

// Windows and macOS file systems are case-insensitive by default.
const fold = (p: string): string => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);

function within(parent: string, child: string): boolean {
  const rel = path.relative(fold(path.resolve(parent)), fold(path.resolve(child)));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Resolves symlinks on the nearest existing ancestor so a link cannot smuggle the target inside.
function realTarget(p: string): string {
  let current = path.resolve(p);
  const tail: string[] = [];
  while (!fs.existsSync(current)) {
    tail.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // The native variant also expands Windows 8.3 short names, which the JS one leaves alone.
  return path.join(fs.realpathSync.native(current), ...tail);
}

export function assertSafeOutDir(outDir: string, guards: Guards): string {
  const target = realTarget(outDir);
  if (within(realTarget(guards.repoRoot), target)) {
    throw new Error('refusing to write inside the repository working tree; choose a directory outside it');
  }
  if (guards.forbidden.some((dir) => within(realTarget(dir), target))) {
    throw new Error('refusing to write inside a real .claude or .threadkeep directory; choose a different directory');
  }
  if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length > 0)) {
    throw new Error('refusing to write into a path that exists and is not an empty directory');
  }
  return target;
}

// Built from parts so the repository never contains the finished string.
export function fakeSecret(): string {
  return ['sk', 'ant', 'demo', 'FAKE0123456789abcdefghijkl'].join('-');
}

export function makeFixtures(outDir: string, adapters: SampleAdapter[], guards: Guards): { adapter: string; files: string[] }[] {
  const target = assertSafeOutDir(outDir, guards);
  const secret = fakeSecret();
  return adapters.map((adapter) => {
    const root = path.join(target, adapter.id);
    const { files } = adapter.fixtures.sample({ root, secret });
    return { adapter: adapter.id, files: files.map((f) => `${adapter.id}/${f}`) };
  });
}

// Directories fixtures must never be written into: the real data dirs under every known home,
// plus any directory the environment redirects them to.
export function forbiddenDirs(env: Record<string, string | undefined>, homedir: string): string[] {
  const homes = [homedir, env['USERPROFILE'], env['HOME']].filter((h): h is string => !!h);
  const dirs = homes.flatMap((h) => [path.join(h, '.claude'), path.join(h, '.threadkeep')]);
  for (const key of ['THREADKEEP_HOME', 'CLAUDE_CONFIG_DIR']) {
    const value = env[key];
    if (value) dirs.push(value);
  }
  return dirs;
}

async function main(): Promise<number> {
  const [outDir, ...extra] = process.argv.slice(2);
  if (!outDir || extra.length > 0) {
    process.stderr.write('usage: pnpm fixtures <output dir>\n');
    return 2;
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let core: { adapters: SampleAdapter[] };
  try {
    core = (await import('../packages/core/dist/index.js')) as { adapters: SampleAdapter[] };
  } catch {
    process.stderr.write('error: packages/core is not built; run pnpm build first\n');
    return 1;
  }
  const forbidden = forbiddenDirs(process.env, os.homedir());
  try {
    const written = makeFixtures(outDir, core.adapters, { repoRoot, forbidden });
    for (const { files } of written) for (const file of files) process.stdout.write(`${file}\n`);
    process.stdout.write(
      'next: point a claude-code source root at <dir>/claude-code in a scratch threadkeep home, then run\n' +
        '  threadkeep ingest and threadkeep import claude-ai <dir>/claude-ai/export.zip with --home <scratch home>\n',
    );
    return 0;
  } catch (error) {
    process.stderr.write(`error: ${(error as Error).message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

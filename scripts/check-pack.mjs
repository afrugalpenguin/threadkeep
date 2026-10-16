// Checks what `npm pack` would publish for every package in packages/*. Run after `pnpm build`.
// Only dist/, README.md, LICENSE and package.json may ship, and package.json must carry the
// expected author, the MIT licence and no email address. Prints file counts only.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_AUTHOR = 'afrugalpenguin';
const REQUIRED = ['README.md', 'LICENSE', 'package.json'];
const emailLike = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/;

// Returns a list of problems (empty when fine). Never includes file contents.
export function evaluatePackage(name, files, manifestText) {
  const problems = [];
  for (const file of files) {
    if (!file.startsWith('dist/') && !REQUIRED.includes(file)) problems.push(`${name}: unexpected file in tarball: ${file}`);
  }
  for (const required of REQUIRED) {
    if (!files.includes(required)) problems.push(`${name}: ${required} is missing from the tarball`);
  }
  if (!files.some((f) => f.startsWith('dist/'))) problems.push(`${name}: dist/ is empty or missing, run pnpm build first`);
  problems.push(...evaluateManifest(name, manifestText));
  return problems;
}

export function evaluateManifest(name, manifestText) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return [`${name}: package.json is not valid JSON`];
  }
  if (manifest.author !== EXPECTED_AUTHOR) problems.push(`${name}: author must be the plain string ${EXPECTED_AUTHOR}`);
  if (manifest.license !== 'MIT') problems.push(`${name}: license must be MIT`);
  if (emailLike.test(manifestText)) problems.push(`${name}: package.json contains an email address`);
  return problems;
}

function packFiles(dir) {
  const win = process.platform === 'win32';
  const out = execFileSync(win ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: dir,
    encoding: 'utf8',
    shell: win,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [report] = JSON.parse(out);
  return report.files.map((f) => f.path.split(String.fromCharCode(92)).join('/'));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = [...evaluateManifest('workspace', fs.readFileSync(path.join(root, 'package.json'), 'utf8'))];
  const packagesDir = path.join(root, 'packages');
  const names = fs.readdirSync(packagesDir).filter((n) => fs.existsSync(path.join(packagesDir, n, 'package.json'))).sort();
  for (const name of names) {
    const dir = path.join(packagesDir, name);
    const files = packFiles(dir);
    problems.push(...evaluatePackage(name, files, fs.readFileSync(path.join(dir, 'package.json'), 'utf8')));
    process.stdout.write(`${name}: ${files.length} files\n`);
  }
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.stderr.write(`pack check failed: ${problems.length} problem(s)\n`);
    return 1;
  }
  process.stdout.write(`pack check ok: ${names.length} packages\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();

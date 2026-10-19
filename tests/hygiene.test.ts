import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLine, collectSessionIds, excludedFiles, parseDenylist, requiredIgnorePatterns } from '../scripts/hygiene-rules.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('.gitignore', () => {
  const patterns = readFileSync(join(repoRoot, '.gitignore'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim());

  it.each(requiredIgnorePatterns)('keeps %s', (pattern) => {
    expect(patterns).toContain(pattern);
  });
});

describe('hygiene rules', () => {
  // Offending samples are assembled at runtime so this file passes its own scan.
  const realUnix = ['', 'home', 'someone', 'work'].join('/');
  const realMac = ['', 'Users', 'someone', 'work'].join('/');
  const realWindows = ['C:', 'Users', 'someone', 'work'].join('\\');
  const realEmail = ['someone', 'corp.test.io'].join('@');

  it('flags absolute home paths on every platform', () => {
    expect(checkLine(realUnix)).toEqual(['home-path']);
    expect(checkLine(realMac)).toEqual(['home-path']);
    expect(checkLine(realWindows)).toEqual(['home-path']);
  });

  it('allows the placeholder user and bare path prefixes', () => {
    expect(checkLine('/home/alice/projects/demo')).toEqual([]);
    expect(checkLine('C:\\Users\\alice\\projects\\demo')).toEqual([]);
    expect(checkLine('scans for /Users/, /home/ and similar')).toEqual([]);
  });

  it('flags emails but not version specifiers or example domains', () => {
    expect(checkLine(`contact ${realEmail}`)).toEqual(['email']);
    expect(checkLine('pnpm@10.12.1 and actions/checkout@v4')).toEqual([]);
    expect(checkLine('alice@example.com')).toEqual([]);
  });

  it('flags em and en dashes but not hyphens', () => {
    expect(checkLine(`a ${String.fromCodePoint(0x2014)} b`)).toEqual(['dash']);
    expect(checkLine(`1${String.fromCodePoint(0x2013)}2`)).toEqual(['dash']);
    expect(checkLine('a - b and kebab-case')).toEqual([]);
  });

  it('flags paths into a .claude projects dir with either slash, but not the bare dir', () => {
    const dir = ['.claude', 'projects'];
    expect(checkLine(`~/${dir.join('/')}/-work-app/x.jsonl`)).toEqual(['claude-projects-path']);
    expect(checkLine(`D:\\${dir.join('\\')}\\C--work-app`)).toEqual(['claude-projects-path']);
    expect(checkLine(`"D:\\\\${dir.join('\\\\')}\\\\C--work-app"`)).toEqual(['claude-projects-path']);
    expect(checkLine(`reads ~/${dir.join('/')} and never modifies it`)).toEqual([]);
    expect(checkLine(`'~/${dir.join('/')}/'`)).toEqual([]);
    expect(checkLine(`~/${dir.join('/')}/<project>/<session>.jsonl`)).toEqual([]);
    expect(checkLine(`/ingested ~\\/\\${dir.join('\\/')}\\/.*\\.jsonl/`)).toEqual([]);
  });

  it('flags session ids that exist on this machine, in any case, but not other uuids', () => {
    const real = 'd3adbeef-1234-4abc-8def-0123456789ab';
    const ids = new Set([real]);
    expect(checkLine(`resume ${real} later`, [], ids)).toEqual(['real-session-id']);
    expect(checkLine(`resume ${real.toUpperCase()} later`, [], ids)).toEqual(['real-session-id']);
    expect(checkLine('aaaaaaaa-0000-4000-8000-000000000001', [], ids)).toEqual([]);
  });

  it('matches denylist entries case-insensitively and reports only the index', () => {
    const denylist = parseDenylist('# comment\n\nFirstEntry\nsecond-entry\n');
    expect(denylist).toEqual(['firstentry', 'second-entry']);
    expect(checkLine('mentions SECOND-ENTRY here', denylist)).toEqual(['denylist-entry-2']);
  });
});

describe('example denylist', () => {
  const examplePath = join(repoRoot, 'denylist.example.txt');
  const entries = parseDenylist(readFileSync(examplePath, 'utf8'));

  it('is excluded from the scan', () => {
    expect(excludedFiles).toContain('denylist.example.txt');
    const output = execFileSync('node', ['scripts/check-hygiene.mjs', '--tracked'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, HANSARD_DENYLIST: examplePath },
    });
    expect(output).toMatch(/ 0 findings/);
  });

  it('has entries that are detected in any other content', () => {
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((entry: string, index: number) => {
      expect(checkLine(`some text with ${entry} inside`, entries)).toEqual([`denylist-entry-${index + 1}`]);
    });
  });
});

describe('tracked files', () => {
  it('contain no home paths or email addresses', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    const findings: string[] = [];
    for (const file of files) {
      const path = join(repoRoot, file);
      if (!existsSync(path)) continue;
      const buffer = readFileSync(path);
      if (buffer.includes(0)) continue;
      buffer
        .toString('utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const rule of checkLine(line)) findings.push(`${file}:${index + 1} ${rule}`);
        });
    }
    expect(findings).toEqual([]);
  });
});

describe('real session ids', () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'hansard-hygiene-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });
  const ID_A = '0d0d0d0d-1111-4222-8333-444444444444';
  const ID_B = '0e0e0e0e-1111-4222-8333-444444444444';

  it('collects uuid named files and folders at any depth, and nothing else', () => {
    const root = tempDir();
    mkdirSync(join(root, '-work-app', ID_A, 'subagents'), { recursive: true });
    writeFileSync(join(root, '-work-app', `${ID_A}.jsonl`), '');
    writeFileSync(join(root, '-work-app', ID_A, 'subagents', 'agent-x.jsonl'), '');
    mkdirSync(join(root, 'raw', 'claude-code', 'machine', '-old'), { recursive: true });
    writeFileSync(join(root, 'raw', 'claude-code', 'machine', '-old', `${ID_B.toUpperCase()}.jsonl`), '');
    writeFileSync(join(root, 'notes.txt'), '');
    expect([...collectSessionIds([root, join(root, 'missing')])].sort()).toEqual([ID_A, ID_B]);
  });

  const runCheck = (roots: string) =>
    spawnSync('node', ['scripts/check-hygiene.mjs', '--tracked'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, HANSARD_DENYLIST: join(repoRoot, 'denylist.example.txt'), HANSARD_SESSION_ROOTS: roots },
    });

  it('fails the scan when a tracked file contains an id found on this machine, without printing it', () => {
    const root = tempDir();
    // The fixture sessions are tracked, so pretending one of their ids is real must fail the scan.
    writeFileSync(join(root, 'aaaaaaaa-0000-4000-8000-000000000002.jsonl'), '');
    const r = runCheck(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/real-session-id/);
    expect(r.stderr + r.stdout).not.toContain('aaaaaaaa-0000-4000-8000-000000000002');
    expect(runCheck(tempDir()).status).toBe(0);
  });

  it('fails closed when a session root exists but cannot be read as a directory', () => {
    const file = join(tempDir(), 'not-a-dir');
    writeFileSync(file, '');
    const r = runCheck(file);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/failing closed/i);
  });
});

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkLine, excludedFiles, parseDenylist, requiredIgnorePatterns } from '../scripts/hygiene-rules.mjs';

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

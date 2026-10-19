#!/usr/bin/env node
// Hygiene gate: fails if staged, tracked or historical content contains absolute home paths,
// email addresses or any entry from the local denylist.
//
//   --staged   lines added in the staged diff (pre-commit)
//   --tracked  every tracked file (CI, local full check)
//   --history  every line added anywhere in git history (before publishing)
//
// The denylist is read from HANSARD_DENYLIST or ~/.hansard/denylist.txt. A missing denylist
// is a failure. Output lists file, line number and rule name only.
//
// Session ids that exist on this machine are also rejected. They are collected from the Claude Code
// projects dir and the hansard archive, or from HANSARD_SESSION_ROOTS (a path-delimited list) when set.
// A root that exists but cannot be read is a failure.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { checkLine, collectSessionIds, excludedFiles, parseDenylist, redactSessionIds } from './hygiene-rules.mjs';

const mode = process.argv[2];
if (!['--staged', '--tracked', '--history'].includes(mode)) {
  console.error('usage: check-hygiene.mjs --staged | --tracked | --history');
  process.exit(2);
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 });

function loadDenylist() {
  const path = process.env.HANSARD_DENYLIST ?? join(homedir(), '.hansard', 'denylist.txt');
  if (!existsSync(path)) {
    console.error('hygiene: denylist not found. Create it from denylist.example.txt at');
    console.error('  ~/.hansard/denylist.txt (or set HANSARD_DENYLIST). Failing closed.');
    process.exit(1);
  }
  return parseDenylist(readFileSync(path, 'utf8'));
}

// Mirrors loadContext in packages/core: archiveRoot from config.json, "<home>" and "~" expanded.
function defaultSessionRoots() {
  const userHome = homedir();
  const home = resolve(process.env.HANSARD_HOME ?? join(userHome, '.hansard'));
  let archiveRoot = '<home>/archive';
  const configPath = join(home, 'config.json');
  if (existsSync(configPath)) archiveRoot = JSON.parse(readFileSync(configPath, 'utf8')).archiveRoot ?? archiveRoot;
  if (archiveRoot.startsWith('<home>')) archiveRoot = join(home, archiveRoot.slice('<home>'.length));
  else if (archiveRoot === '~' || /^~[\\/]/.test(archiveRoot)) archiveRoot = join(userHome, archiveRoot.slice(1));
  if (!isAbsolute(archiveRoot)) archiveRoot = resolve(archiveRoot);
  return [join(userHome, '.claude', 'projects'), archiveRoot];
}

function loadSessionIds() {
  try {
    const override = process.env.HANSARD_SESSION_ROOTS;
    return collectSessionIds(override ? override.split(delimiter).filter(Boolean) : defaultSessionRoots());
  } catch {
    console.error('hygiene: could not read the session roots to collect real session ids. Failing closed.');
    process.exit(1);
  }
}

// Yields { file, line, text } for every added line in a unified diff.
function* addedLines(diff) {
  let file = '';
  let line = 0;
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) {
      file = text.slice(4).replace(/^b\//, '');
    } else if (text.startsWith('@@')) {
      line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0) - 1;
    } else if (text.startsWith('+')) {
      line += 1;
      yield { file, line, text: text.slice(1) };
    } else if (!text.startsWith('-')) {
      line += 1;
    }
  }
}

function* trackedLines() {
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  for (const file of files) {
    if (!existsSync(file)) continue;
    const buffer = readFileSync(file);
    if (buffer.includes(0)) continue; // binary
    const lines = buffer.toString('utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      yield { file, line: index + 1, text: lines[index] };
    }
  }
}

function source() {
  if (mode === '--staged') return addedLines(git(['diff', '--cached', '--unified=0', '--no-color', '--text']));
  if (mode === '--history') return addedLines(git(['log', '--all', '-p', '--unified=0', '--no-color', '--text', '--format=']));
  return trackedLines();
}

const denylist = loadDenylist();
const sessionIds = loadSessionIds();
let scanned = 0;
let findings = 0;
for (const { file, line, text } of source()) {
  if (excludedFiles.includes(file)) continue;
  scanned += 1;
  for (const rule of checkLine(text, denylist, sessionIds)) {
    findings += 1;
    console.error(`hygiene: ${redactSessionIds(file, sessionIds)}:${line} ${rule}`);
  }
}

console.log(
  `hygiene ${mode.slice(2)}: ${scanned} lines scanned, ${denylist.length} denylist entries, ${sessionIds.size} known session ids, ${findings} findings`,
);
process.exit(findings === 0 ? 0 : 1);

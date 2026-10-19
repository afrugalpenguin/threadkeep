// Shared rules for the hygiene gate. Used by scripts/check-hygiene.mjs and tests/hygiene.test.ts.
// Patterns are built from parts so this file does not match itself.

import { existsSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';

const sep = '[\\\\/]';

// Placeholder user allowed in synthetic fixtures and docs.
const placeholderUser = 'alice';

export const homePathPatterns = [
  new RegExp(`${sep}Users${sep}(?!${placeholderUser}\\b)[A-Za-z0-9]`),
  new RegExp(`${sep}home${sep}(?!${placeholderUser}\\b)[A-Za-z0-9]`),
];

// A path that continues into a Claude Code projects dir names a real project folder, and project folder
// names start with a letter, digit or '-'. The bare dir, a <placeholder> or a regex is left alone.
export const claudeProjectsPathPattern = new RegExp(`\\.claude${sep}+projects${sep}+[A-Za-z0-9-]`);

const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const uuidName = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.jsonl)?$/i;

// Lowercased ids of every uuid named file or folder under the given roots (sessions, their subagent
// folders, archived copies). A missing root is skipped; any other read error is thrown so callers fail closed.
export function collectSessionIds(roots) {
  const ids = new Set();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true })) {
      const match = uuidName.exec(basename(String(entry)));
      if (match) ids.add(match[1].toLowerCase());
    }
  }
  return ids;
}

// File names can be session ids too, so findings never print one.
export function redactSessionIds(text, sessionIds) {
  return text.replace(uuidPattern, (id) => (sessionIds.has(id.toLowerCase()) ? '<session-id>' : id));
}

// Requires an alphabetic top-level domain so version specifiers such as name@1.2.3 do not match.
const emailPattern = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;

const allowedEmailDomains = ['example.com', 'example.org', 'users.noreply.github.com'];

export function findEmails(line) {
  const hits = [];
  for (const match of line.matchAll(emailPattern)) {
    const domain = match[0].slice(match[0].lastIndexOf('@') + 1).toLowerCase();
    if (!allowedEmailDomains.includes(domain)) hits.push(match[0]);
  }
  return hits;
}

// Em dash and en dash, built from code points so this file does not match itself.
export const dashPattern = new RegExp(`[${String.fromCodePoint(0x2014)}${String.fromCodePoint(0x2013)}]`);

export function parseDenylist(text) {
  return text
    .split(/\r?\n/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '' && !entry.startsWith('#'));
}

// Returns rule names only. Matched text and denylist entries are never returned,
// so findings can be printed in public CI logs.
export function checkLine(line, denylist = [], sessionIds = new Set()) {
  const rules = [];
  if (homePathPatterns.some((pattern) => pattern.test(line))) rules.push('home-path');
  if (claudeProjectsPathPattern.test(line)) rules.push('claude-projects-path');
  if (sessionIds.size > 0 && [...line.matchAll(uuidPattern)].some((m) => sessionIds.has(m[0].toLowerCase()))) {
    rules.push('real-session-id');
  }
  if (findEmails(line).length > 0) rules.push('email');
  if (dashPattern.test(line)) rules.push('dash');
  const lower = line.toLowerCase();
  denylist.forEach((entry, index) => {
    if (lower.includes(entry)) rules.push(`denylist-entry-${index + 1}`);
  });
  return rules;
}

// The shipped example denylist would otherwise fail the scan for anyone who copies it
// to the expected location unchanged.
export const excludedFiles = ['denylist.example.txt'];

export const requiredIgnorePatterns = [
  '*.db',
  '*.db-*',
  '*.jsonl',
  '*.zip',
  '*.log',
  '.env*',
  'local/',
  'uploads/',
  'exports/',
  'coverage/',
  '.hansard/',
];

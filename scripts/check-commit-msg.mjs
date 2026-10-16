#!/usr/bin/env node
// commit-msg gate: conventional commit subject, subject length, no em or en dashes.
//
//   node scripts/check-commit-msg.mjs <path-to-commit-message-file>

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dashPattern } from './hygiene-rules.mjs';

const types = ['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'build', 'ci', 'perf', 'style'];
const subjectPattern = new RegExp(`^(${types.join('|')})\\(.+\\): .+`);
const maxSubjectLength = 72;

export function checkCommitMessage(message) {
  const lines = message.split(/\r?\n/).filter((line) => !line.startsWith('#'));
  const subject = lines[0] ?? '';
  const problems = [];
  if (!subjectPattern.test(subject)) problems.push(`subject must be type(scope): description, types: ${types.join(', ')}`);
  if (subject.length > maxSubjectLength) problems.push(`subject is ${subject.length} chars, max ${maxSubjectLength}`);
  if (lines.some((line) => dashPattern.test(line))) problems.push('message contains an em or en dash, use a hyphen');
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: check-commit-msg.mjs <message-file>');
    process.exit(2);
  }
  const problems = checkCommitMessage(readFileSync(path, 'utf8'));
  for (const problem of problems) console.error(`commit-msg: ${problem}`);
  process.exit(problems.length === 0 ? 0 : 1);
}

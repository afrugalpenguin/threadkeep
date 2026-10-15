import { ingestAll, openDb } from '../src/index.js';
import { makeMachine, writeSession } from './helpers.js';
import { describe, expect, it } from 'vitest';
import { isSystemGeneratedUserText, parseClaudeCode } from '../src/adapters/claude-code/parse.js';
import { assistant, flaggedUserText, toolResultLine, userText } from '../src/adapters/claude-code/fixtures.js';

const SID = '44444444-4444-4444-8444-444444444444';
const file = { machineId: 'm1', relPath: `raw/claude-code/m1/p/${SID}.jsonl`, absPath: 'unused' };
const b = (n: number) => ({ sessionId: SID, uuid: `u${n}`, timestamp: `2026-01-01T10:00:0${n}.000Z` });
const roleOf = (text: string) => parseClaudeCode(file, { text, startOffset: 0 }).events.map((e) => `${e.role}/${e.kind}`);

describe('isSystemGeneratedUserText', () => {
  it.each([
    ['<local-command-stdout>ok</local-command-stdout>'],
    ['  \n<local-command-stderr>bad</local-command-stderr>'],
    ['<local-command-caveat>Caveat: generated</local-command-caveat>'],
    ['<task-notification>done</task-notification>'],
    ['[Request interrupted by user]'],
    ['[Request interrupted by user for tool use]'],
  ])('flags %s', (text) => expect(isSystemGeneratedUserText(text)).toBe(true));

  it.each([
    ['please fix the bug'],
    ['<command-name>/clear</command-name>'],
    ['what does <task-notification> mean here?'],
    ['I saw "[Request interrupted by user]" in the log'],
    [''],
  ])('does not flag %s', (text) => expect(isSystemGeneratedUserText(text)).toBe(false));
});

describe('claude code user lines that are not typed by the human', () => {
  it('marks isMeta lines as system', () => {
    const text = flaggedUserText(b(1), 'Base directory for this skill: /x', { isMeta: true });
    expect(roleOf(text)).toEqual(['system/text']);
  });

  it('marks isMeta array content as system', () => {
    const text = flaggedUserText(b(1), [{ type: 'text', text: 'skill body' }], { isMeta: true });
    expect(roleOf(text)).toEqual(['system/text']);
  });

  it('marks compact summaries as system', () => {
    const text = flaggedUserText(b(1), 'This session is being continued', { isCompactSummary: true });
    expect(roleOf(text)).toEqual(['system/text']);
  });

  it.each([
    '<local-command-stdout>x</local-command-stdout>',
    '<local-command-caveat>x</local-command-caveat>',
    '<task-notification>x</task-notification>',
    '[Request interrupted by user]',
    '[Request interrupted by user for tool use]',
  ])('marks %s as system', (content) => {
    expect(roleOf(userText(b(1), content))).toEqual(['system/text']);
    expect(roleOf(userText(b(1), [{ type: 'text', text: content }]))).toEqual(['system/text']);
  });

  it('keeps content unchanged', () => {
    const r = parseClaudeCode(file, { text: userText(b(1), '<task-notification>x</task-notification>'), startOffset: 0 });
    expect(r.events[0]?.content).toBe('<task-notification>x</task-notification>');
  });

  it('keeps normal prompts and slash commands as user', () => {
    expect(roleOf(userText(b(1), 'fix it'))).toEqual(['user/text']);
    expect(roleOf(userText(b(1), '<command-name>/clear</command-name>'))).toEqual(['user/text']);
    expect(roleOf(userText(b(1), 'does <task-notification> appear mid text?'))).toEqual(['user/text']);
  });

  it('never reclassifies assistant text, and tool results still become patches', () => {
    expect(roleOf(assistant(b(1), [{ type: 'text', text: '<task-notification>x' }]))).toEqual(['assistant/text']);
    const r = parseClaudeCode(file, { text: toolResultLine(b(2), 't1', '<task-notification>x'), startOffset: 0 });
    expect(r.events).toEqual([]);
    expect(r.patches).toHaveLength(1);
  });
});

describe('session titles ignore system generated lines', () => {
  const titleOf = async (text: string) => {
    const m = makeMachine();
    writeSession(m.claudeRoot, SID, text);
    await ingestAll(m.ctx);
    const db = openDb(m.ctx.dbPath);
    try {
      return (db.prepare('select title from sessions').get() as { title: string | null }).title;
    } finally {
      db.close();
    }
  };

  it('uses the first human prompt, not an earlier skill body or caveat', async () => {
    const title = await titleOf(
      flaggedUserText(b(1), 'Base directory for this skill: /x', { isMeta: true }) +
        userText(b(2), '<local-command-caveat>Caveat</local-command-caveat>') +
        userText(b(3), 'the real prompt'),
    );
    expect(title).toBe('the real prompt');
  });

  it('leaves the title empty when only system lines exist', async () => {
    const title = await titleOf(flaggedUserText(b(1), 'Base directory for this skill: /x', { isMeta: true }));
    expect(title ?? '').toBe('');
  });
});

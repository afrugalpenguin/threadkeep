import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseClaudeCode } from '../src/adapters/claude-code/parse.js';
import { FIXTURE_SESSIONS, fixturePath } from './fixture-files.js';

const parseFixture = (session: { id: string; folder: string }) => {
  const text = fs.readFileSync(fixturePath(session), 'utf8');
  const file = { machineId: 'm1', relPath: `raw/claude-code/m1/${session.folder}/${session.id}.jsonl`, absPath: 'unused' };
  return { text, file, parsed: parseClaudeCode(file, { text, startOffset: 0 }) };
};

describe('claude code parser on fixture files', () => {
  it('parses text, thinking, a tool call and its result, and keeps every line as a raw record', () => {
    const { text, parsed } = parseFixture(FIXTURE_SESSIONS.vacuum);
    expect(parsed.records).toHaveLength(text.trimEnd().split('\n').length);
    expect(parsed.records.every((r) => !r.unparsed && r.sessionId === FIXTURE_SESSIONS.vacuum.id)).toBe(true);
    expect(parsed.events.map((e) => [e.role, e.kind])).toEqual([
      ['user', 'text'],
      ['assistant', 'thinking'],
      ['assistant', 'text'],
      ['tool', 'tool'],
      ['assistant', 'text'],
    ]);
    const tool = parsed.events[3];
    expect(tool?.toolName).toBe('Bash');
    expect(tool?.content).toBe("sqlite3 demo.db 'vacuum'");
    expect(parsed.patches).toHaveLength(1);
    expect(parsed.patches[0]?.eventId).toBe(tool?.id);
    expect(parsed.events.every((e) => e.projectDir === '/home/alice/projects/demo')).toBe(true);
    expect(parsed.sessions).toContainEqual({ sessionId: FIXTURE_SESSIONS.vacuum.id, aiTitle: 'Shrinking the demo sqlite file' });
    expect(parsed.warnings).toEqual([]);
  });

  it('marks generated user lines as system, keeps images as attachments and survives a cut off line', () => {
    const { parsed } = parseFixture(FIXTURE_SESSIONS.kestrel);
    expect(parsed.events.map((e) => [e.role, e.kind])).toEqual([
      ['system', 'text'],
      ['user', 'text'],
      ['tool', 'tool'],
      ['system', 'text'],
      ['assistant', 'text'],
    ]);
    expect(parsed.events[1]?.attachments).toEqual([{ type: 'image', media_type: 'image/png' }]);
    expect(parsed.events[2]?.filesTouched).toEqual(['/home/alice/projects/demo/src/worker.ts']);
    expect(parsed.patches[0]?.outputText).toContain('process.exit(0)');
    expect(parsed.records.filter((r) => r.unparsed)).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(1);
  });

  it('keeps summary lines raw, records failed tool results and Windows project paths', () => {
    const { parsed } = parseFixture(FIXTURE_SESSIONS.notes);
    expect(parsed.records[0]?.raw).toContain('"type":"summary"');
    expect(parsed.events.map((e) => [e.role, e.kind])).toEqual([
      ['user', 'text'],
      ['tool', 'tool'],
      ['assistant', 'text'],
    ]);
    const notesDir = ['C:', 'Users', 'alice', 'projects', 'notes'].join('\\');
    expect(parsed.events[0]?.projectDir).toBe(notesDir);
    // The one-line summary prefers path over pattern.
    expect(parsed.events[1]?.content).toBe(notesDir);
    expect(parsed.events[1]?.toolInput).toContain('action item');
    expect(JSON.parse(parsed.patches[0]?.toolOutput ?? '{}').is_error).toBe(true);
  });

  it('gives the same records and ids whether a file is parsed whole or in two chunks', () => {
    for (const session of Object.values(FIXTURE_SESSIONS)) {
      const { text, file, parsed: whole } = parseFixture(session);
      const cut = text.indexOf('\n', Math.floor(text.length / 2)) + 1;
      const head = parseClaudeCode(file, { text: text.slice(0, cut), startOffset: 0 });
      const tail = parseClaudeCode(file, { text: text.slice(cut), startOffset: Buffer.byteLength(text.slice(0, cut)) });
      expect([...head.records, ...tail.records]).toEqual(whole.records);
      expect([...head.events, ...tail.events].map((e) => e.id)).toEqual(whole.events.map((e) => e.id));
    }
  });
});

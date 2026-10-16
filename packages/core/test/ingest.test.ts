import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BusyError, ingestAll, ingestFile, openDb, withLock, type HansardContext } from '../src/index.js';
import { claudeCodeAdapter } from '../src/adapters/claude-code/index.js';
import { parseClaudeCode } from '../src/adapters/claude-code/parse.js';
import { aiTitle, assistant, line, toolResultLine, userText } from '../src/adapters/claude-code/fixtures.js';
import { FIXTURE_FOLDER, appendSession, archiveSessionPath, makeMachine, sha256File, writeSession } from './helpers.js';

const SID = '11111111-1111-4111-8111-111111111111';
const file = { machineId: 'm1', relPath: `raw/claude-code/m1/p/${SID}.jsonl`, absPath: 'unused' };
const b = (n: number, extra: object = {}) => ({
  sessionId: SID,
  uuid: `u${n}`,
  timestamp: `2026-01-01T10:00:0${n}.000Z`,
  ...extra,
});
const READ_USE = assistant(b(2), [
  { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/home/alice/projects/demo/a.txt' } },
]);

const rows = (ctx: HansardContext, sql: string) => {
  const db = openDb(ctx.dbPath);
  try {
    return db.prepare(sql).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
};

describe('claude code parser', () => {
  it('handles string and array user content, split assistant lines and thinking', () => {
    const text =
      userText(b(1), 'plain question') +
      userText(b(2), [{ type: 'text', text: 'array question' }]) +
      assistant(b(3), [
        { type: 'thinking', thinking: 'pondering', signature: 'x' },
        { type: 'text', text: 'part one' },
      ]) +
      assistant(b(4), [{ type: 'text', text: 'part two' }]);
    const r = parseClaudeCode(file, { text, startOffset: 0 });
    expect(r.events.map((e) => [e.role, e.kind, e.content])).toEqual([
      ['user', 'text', 'plain question'],
      ['user', 'text', 'array question'],
      ['assistant', 'thinking', 'pondering'],
      ['assistant', 'text', 'part one'],
      ['assistant', 'text', 'part two'],
    ]);
    expect(new Set(r.events.map((e) => e.id)).size).toBe(5);
    expect(r.events.every((e) => e.id.length === 32)).toBe(true);
  });

  it('keeps malformed lines as unparsed raw records with a relative warning', () => {
    const text = `${userText(b(1), 'ok')}{not json\n`;
    const r = parseClaudeCode(file, { text, startOffset: 100 });
    expect(r.records.map((x) => x.unparsed)).toEqual([false, true]);
    expect(r.records[0]?.byteOffset).toBe(100);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain(file.relPath);
  });

  it('records images as attachment metadata only, creating an empty user event when needed', () => {
    const text = userText(b(1), [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJDREVGR0g' } }]);
    const r = parseClaudeCode(file, { text, startOffset: 0 });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]?.content).toBe('');
    expect(r.events[0]?.attachments).toEqual([{ type: 'image', media_type: 'image/png' }]);
    expect(JSON.stringify(r.events)).not.toContain('QUJDREVGR0g');
  });

  it('turns tool_use into a tool event and tool_result into a patch', () => {
    const text =
      assistant(b(1), [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } }]) +
      toolResultLine(b(2), 't1', [{ type: 'text', text: 'file.txt' }], {
        toolUseResult: { filePath: '/home/alice/projects/demo/file.txt' },
      });
    const r = parseClaudeCode(file, { text, startOffset: 0 });
    expect(r.events[0]).toMatchObject({ role: 'tool', kind: 'tool', toolName: 'Bash', content: 'ls -la' });
    expect(r.patches[0]?.eventId).toBe(r.events[0]?.id);
    expect(r.patches[0]?.outputText).toBe('file.txt');
    expect(r.patches[0]?.filesTouched).toEqual(['/home/alice/projects/demo/file.txt']);
  });

  it('collects ai titles and cwd changes and keeps bookkeeping lines as raw only', () => {
    const text =
      userText(b(1, { cwd: '/home/alice/projects/demo' }), 'one') +
      userText(b(2, { cwd: '/home/alice/projects/other' }), 'two') +
      aiTitle(SID, 'First') +
      aiTitle(SID, 'Second') +
      line({ type: 'permission-mode', mode: 'default' });
    const r = parseClaudeCode(file, { text, startOffset: 0 });
    expect(r.sessions.filter((s) => s.aiTitle).map((s) => s.aiTitle)).toEqual(['First', 'Second']);
    expect(r.sessions.filter((s) => s.cwd).map((s) => s.cwd)).toEqual([
      '/home/alice/projects/demo',
      '/home/alice/projects/other',
    ]);
    expect(r.records).toHaveLength(5);
    expect(r.events).toHaveLength(2);
  });
});

describe('ingest', () => {
  const setup = () => {
    const m = makeMachine();
    const text =
      userText(b(1), 'Demo conversation 1') + READ_USE + toolResultLine(b(3), 't1', 'contents') + aiTitle(SID, 'Last title');
    writeSession(m.claudeRoot, SID, text);
    return m;
  };

  it('ingests, and a second run is a no-op', async () => {
    const { ctx } = setup();
    const first = await ingestAll(ctx);
    expect(first.newRaw).toBe(4);
    expect(first.newEvents).toBe(2);
    const second = await ingestAll(ctx);
    expect([second.newRaw, second.newEvents, second.filesIngested, second.mirroredBytes]).toEqual([0, 0, 0, 0]);
    const [session] = rows(ctx, 'select * from sessions');
    expect(session).toMatchObject({ id: SID, source: 'claude-code', project_dir: '/home/alice/projects/demo', event_count: 2 });
    expect(session?.['machine_id']).toBe(ctx.machineId);
  });

  it('merges a tool result that arrives in the same chunk', async () => {
    const { ctx } = setup();
    await ingestAll(ctx);
    const [tool] = rows(ctx, "select * from events where kind = 'tool'");
    expect(tool?.['tool_name']).toBe('Read');
    expect(String(tool?.['content'])).toContain('contents');
    expect(JSON.parse(String(tool?.['tool_output']))).toMatchObject({ is_error: false });
    expect(JSON.parse(String(tool?.['files_touched']))).toEqual(['/home/alice/projects/demo/a.txt']);
  });

  const toolRows = (ctx: HansardContext) =>
    rows(ctx, "select id, content, tool_name, tool_input, tool_output, files_touched from events order by id");

  it('merges a tool result that arrives in a later run, same as a one-shot ingest', async () => {
    const a = makeMachine();
    const result = toolResultLine(b(3), 't1', 'contents');
    const f = writeSession(a.claudeRoot, SID, userText(b(1), 'hi') + READ_USE);
    await ingestAll(a.ctx);
    appendSession(f, result);
    await ingestAll(a.ctx);

    const c = makeMachine();
    writeSession(c.claudeRoot, SID, userText(b(1), 'hi') + READ_USE + result);
    await ingestAll(c.ctx);
    expect(toolRows(a.ctx)).toEqual(toolRows(c.ctx));
  });

  it('converges when a result arrives before its tool_use', async () => {
    const a = makeMachine();
    const result = toolResultLine(b(3), 't1', 'contents');
    const f = writeSession(a.claudeRoot, SID, result);
    await ingestAll(a.ctx);
    appendSession(f, READ_USE);
    await ingestAll(a.ctx);

    const c = makeMachine();
    writeSession(c.claudeRoot, SID, READ_USE + result);
    await ingestAll(c.ctx);
    expect(toolRows(a.ctx)).toHaveLength(1);
    expect(toolRows(a.ctx)).toEqual(toolRows(c.ctx));
  });

  it('warns on unparseable lines using relative paths only', async () => {
    const m = makeMachine();
    writeSession(m.claudeRoot, SID, `${userText(b(1), 'ok')}{broken\n`);
    const r = await ingestAll(m.ctx);
    expect(r.warnings.some((w) => w.includes('unparseable'))).toBe(true);
    expect(r.warnings.join('\n')).not.toContain(m.ctx.home);
    expect(rows(m.ctx, 'select unparsed from raw_records order by byte_offset').map((x) => x['unparsed'])).toEqual([0, 1]);
  });

  it('ignores non-session local files and skips sync-conflict copies in the archive', async () => {
    const m = makeMachine();
    writeSession(m.claudeRoot, SID, userText(b(1), 'ok'));
    const dir = path.join(m.claudeRoot, FIXTURE_FOLDER);
    fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'subagents', 'x.jsonl'), 'ignored\n');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'ignored\n');
    await ingestAll(m.ctx);
    const archiveDir = path.dirname(archiveSessionPath(m.ctx, SID));
    expect(fs.readdirSync(archiveDir)).toEqual([`${SID}.jsonl`]);
    fs.writeFileSync(path.join(archiveDir, `${SID} (conflict copy).jsonl`), userText(b(1), 'dup'));
    const r = await ingestAll(m.ctx);
    expect(r.warnings.some((w) => w.includes('not a session file name'))).toBe(true);
    expect(rows(m.ctx, 'select count(*) as n from events')[0]?.['n']).toBe(1);
  });
});

describe('mirror', () => {
  it('appends only the delta and never copies a partial trailing line', async () => {
    const m = makeMachine();
    const first = userText(b(1), 'one');
    const partial = '{"type":"user","partial';
    const f = writeSession(m.claudeRoot, SID, first + partial);
    const r1 = await ingestAll(m.ctx);
    expect(r1.mirroredBytes).toBe(Buffer.byteLength(first));
    expect(fs.readFileSync(archiveSessionPath(m.ctx, SID), 'utf8')).toBe(first);
    const rest = '":1}\n';
    appendSession(f, rest);
    const r2 = await ingestAll(m.ctx);
    expect(r2.mirroredBytes).toBe(Buffer.byteLength(partial + rest));
    expect(sha256File(archiveSessionPath(m.ctx, SID))).toBe(sha256File(f));
    expect((await ingestAll(m.ctx)).mirroredFiles).toBe(0);
  });

  it('skips when the local file is shorter than the archive, leaving the archive alone', async () => {
    const m = makeMachine();
    const f = writeSession(m.claudeRoot, SID, userText(b(1), 'one') + userText(b(2), 'two'));
    await ingestAll(m.ctx);
    const before = sha256File(archiveSessionPath(m.ctx, SID));
    fs.writeFileSync(f, userText(b(1), 'one'));
    const r = await ingestAll(m.ctx);
    expect(r.warnings.some((w) => w.includes('shorter than archive'))).toBe(true);
    expect(sha256File(archiveSessionPath(m.ctx, SID))).toBe(before);
  });

  it('skips a diverged source and leaves both files untouched', async () => {
    const m = makeMachine();
    const f = writeSession(m.claudeRoot, SID, userText(b(1), 'one'));
    await ingestAll(m.ctx);
    const before = sha256File(archiveSessionPath(m.ctx, SID));
    fs.writeFileSync(f, userText(b(1), 'ONE') + userText(b(2), 'two'));
    const sourceHash = sha256File(f);
    const r = await ingestAll(m.ctx);
    expect(r.warnings.some((w) => w.includes('diverged'))).toBe(true);
    expect(sha256File(archiveSessionPath(m.ctx, SID))).toBe(before);
    expect(sha256File(f)).toBe(sourceHash);
  });

  it('never modifies source files', async () => {
    const m = makeMachine();
    const f = writeSession(m.claudeRoot, SID, userText(b(1), 'one'));
    const before = sha256File(f);
    await ingestAll(m.ctx);
    expect(sha256File(f)).toBe(before);
  });

  it('ingestFile mirrors and ingests one file, and rejects paths outside the root', async () => {
    const m = makeMachine();
    const f = writeSession(m.claudeRoot, SID, userText(b(1), 'one'));
    const r = await ingestFile(m.ctx, f);
    expect(r.newEvents).toBe(1);
    await expect(ingestFile(m.ctx, path.join(m.userHome, 'elsewhere.jsonl'))).rejects.toThrow('not under any');
  });

  it('two concurrent ingestFile runs give an identical archive and no duplicate rows', async () => {
    const m = makeMachine();
    const f = writeSession(m.claudeRoot, SID, userText(b(1), 'one') + userText(b(2), 'two'));
    await Promise.all([ingestFile(m.ctx, f), ingestFile(m.ctx, f)]);
    expect(sha256File(archiveSessionPath(m.ctx, SID))).toBe(sha256File(f));
    expect(rows(m.ctx, 'select count(*) as n from events')).toEqual([{ n: 2 }]);
    expect(rows(m.ctx, 'select count(*) as n from raw_records')).toEqual([{ n: 2 }]);
  });

  it('reports busy when the lock is held', async () => {
    const m = makeMachine();
    writeSession(m.claudeRoot, SID, userText(b(1), 'one'));
    await withLock(m.ctx, { waitMs: 0 }, async () => {
      await expect(ingestAll(m.ctx, { waitMs: 250 })).rejects.toBeInstanceOf(BusyError);
    });
  });

  it('adapter fixtures generate sessions that ingest', async () => {
    const m = makeMachine();
    const { sessionIds } = claudeCodeAdapter.fixtures.generate({ root: m.claudeRoot, sessions: 3 });
    const r = await ingestAll(m.ctx);
    expect(r.newEvents).toBe(sessionIds.length * 3);
  });
});

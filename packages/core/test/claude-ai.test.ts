import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  changeExclusion,
  ingestAll,
  importClaudeAi,
  listSessions,
  openDb,
  rebuild,
  search,
  type HansardContext,
} from '../src/index.js';
import { ISO, conversation, message, sampleExport, textBlock } from '../src/adapters/claude-ai/fixtures.js';
import { makeMachine, sha256File, tempDir } from './helpers.js';
import { writeZip } from './zip.js';

const C1 = 'c0000000-0000-4000-8000-000000000001';
const C2 = 'c0000000-0000-4000-8000-000000000002';
const C3 = 'c0000000-0000-4000-8000-000000000003';

async function exportZip(dir: string, name: string, data: unknown[], extra: Record<string, string> = {}): Promise<string> {
  const file = path.join(dir, name);
  await writeZip(file, { 'conversations.json': JSON.stringify(data), ...extra });
  return file;
}

const rows = (ctx: HansardContext, sql: string) => {
  const db = openDb(ctx.dbPath);
  try {
    return db.prepare(sql).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
};

// The first export, then a later one where m1-1 was edited, m1-3 added and conversations 2 and 3 are absent.
function laterExport(): Record<string, unknown>[] {
  const first = sampleExport()[0] as Record<string, unknown>;
  const messages = (first['chat_messages'] as Record<string, unknown>[]).map((m) =>
    m['uuid'] === 'm1-1'
      ? { ...m, content: [textBlock('Demo question about caching, edited', 1)], updated_at: ISO(30) }
      : m,
  );
  messages.push(message('m1-3', 'human', 5, { content: [textBlock('Demo follow up question', 5)] }));
  return [{ ...first, chat_messages: messages, updated_at: ISO(30) }];
}

describe('claude.ai import', () => {
  it('maps conversations to sessions and events per the approved mapping', async () => {
    const m = makeMachine();
    const dir = tempDir();
    const zip = await exportZip(dir, 'export.zip', sampleExport());
    const report = await importClaudeAi(m.ctx, [zip]);
    expect(report).toMatchObject({ conversationsParts: 1, imported: 1, newConversations: 3, newEvents: 9, failed: 0 });

    const sessions = rows(m.ctx, 'select id, source, machine_id, project_dir, event_count, title, started_at from sessions order by id');
    expect(sessions.map((s) => [s['id'], s['event_count'], s['title']])).toEqual([
      [C1, 4, 'Demo conversation 1'],
      [C2, 5, 'Demo conversation 2 fallback text'],
      [C3, 0, 'Demo empty conversation'],
    ]);
    expect(sessions.every((s) => s['source'] === 'claude-ai' && s['project_dir'] === null)).toBe(true);
    expect(sessions[0]?.['machine_id']).toBe(m.ctx.machineId);

    const events = rows(m.ctx, 'select * from events order by session_id, timestamp, rowid');
    const kinds = events.filter((e) => e['session_id'] === C1).map((e) => e['kind']);
    expect(kinds).toEqual(['text', 'thinking', 'text', 'tool']);
    const tool = events.find((e) => e['tool_name'] === 'web_search');
    expect(String(tool?.['content'])).toContain('cache invalidation');
    expect(String(tool?.['content'])).toContain('result one');
    expect(events.some((e) => String(e['content']).includes('hidden'))).toBe(false);

    // Null-id tool results pair with the nearest preceding unpaired use of the same name.
    const fetches = events.filter((e) => e['tool_name'] === 'fetch');
    const b = fetches.find((e) => String(e['tool_input']).includes('/b'));
    const a = fetches.find((e) => String(e['tool_input']).includes('/a'));
    expect(String(b?.['content'])).toContain('body of b');
    expect(String(a?.['content'])).toContain('body of a');
    const orphan = events.find((e) => e['tool_name'] === 'other');
    expect(String(orphan?.['content'])).toContain('orphan');
    expect(events.filter((e) => e['session_id'] === C2)).toHaveLength(5);

    // Attachments keep metadata only.
    expect(JSON.stringify(events)).not.toContain('EXTRACTED-BODY-MARKER');
    const withAttachments = events.find((e) => e['attachments'] !== null && e['session_id'] === C1);
    expect(JSON.parse(String(withAttachments?.['attachments']))).toEqual([
      { type: 'attachment', file_name: 'notes.txt', file_size: 12, file_type: 'txt' },
      { type: 'file', file_uuid: 'f-1', file_name: 'diagram.png' },
    ]);
    const imageEvent = events.find((e) => e['session_id'] === C2 && e['content'] === '' && e['attachments']);
    expect(JSON.parse(String(imageEvent?.['attachments']))).toEqual([
      { type: 'image', file_uuid: 'img-1' },
      { type: 'document', file_uuid: 'doc-1', title: 'Spec' },
    ]);

    const raw = rows(m.ctx, 'select location, byte_offset, session_id from raw_records order by byte_offset');
    expect(raw.map((r) => r['byte_offset'])).toEqual([0, 1, 2]);
    expect(String(raw[0]?.['location'])).toMatch(/^raw\/claude-ai\/[0-9a-f]{64}\.zip$/);
  });

  it('archives the zip once with a sidecar, byte identical, and records the import', async () => {
    const m = makeMachine();
    const zip = await exportZip(tempDir(), 'export.zip', sampleExport());
    await importClaudeAi(m.ctx, [zip]);
    const sha = sha256File(zip);
    const archived = path.join(m.ctx.archiveRoot, 'raw', 'claude-ai', `${sha}.zip`);
    expect(sha256File(archived)).toBe(sha);
    const sidecar = JSON.parse(fs.readFileSync(path.join(m.ctx.archiveRoot, 'raw', 'claude-ai', `${sha}.json`), 'utf8'));
    expect(sidecar).toMatchObject({ sha256: sha, machine_id: m.ctx.machineId, original_name: 'export.zip' });
    expect(fs.readdirSync(path.dirname(archived)).filter((n) => n.includes('.tmp-'))).toEqual([]);
    const imports = rows(m.ctx, 'select path, sha256, counts from imports');
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ path: 'export.zip', sha256: sha });
    expect(JSON.parse(String(imports[0]?.['counts']))).toMatchObject({ conversations: 3, newEvents: 9 });
  });

  it('importing the same zip twice is a no-op', async () => {
    const m = makeMachine();
    const zip = await exportZip(tempDir(), 'export.zip', sampleExport());
    await importClaudeAi(m.ctx, [zip]);
    const again = await importClaudeAi(m.ctx, [zip]);
    expect(again).toMatchObject({ imported: 0, alreadyImported: 1, newEvents: 0 });
    expect(again.infos.join('\n')).toContain('already imported');
    const all = await ingestAll(m.ctx);
    expect([all.newEvents, all.newRaw, all.updatedEvents]).toEqual([0, 0, 0]);
  });

  it('a later export adds and updates without deleting anything', async () => {
    const m = makeMachine();
    const dir = tempDir();
    await importClaudeAi(m.ctx, [await exportZip(dir, 'one.zip', sampleExport())]);
    const report = await importClaudeAi(m.ctx, [await exportZip(dir, 'two.zip', laterExport())]);
    expect(report).toMatchObject({ newEvents: 1, updatedEvents: 1 });
    expect(rows(m.ctx, 'select count(*) as n from events')[0]?.['n']).toBe(10);
    expect(rows(m.ctx, 'select count(*) as n from sessions')[0]?.['n']).toBe(3);
    const edited = rows(m.ctx, "select content from events where content like '%edited%'");
    expect(edited).toHaveLength(1);
    expect(rows(m.ctx, 'select event_count from sessions where id = ?'.replace('?', `'${C1}'`))[0]?.['event_count']).toBe(5);
  });

  it('converges regardless of the order exports are ingested in', async () => {
    const dir = tempDir();
    const one = await exportZip(dir, 'one.zip', sampleExport());
    const two = await exportZip(dir, 'two.zip', laterExport());
    const a = makeMachine();
    const b = makeMachine();
    await importClaudeAi(a.ctx, [one]);
    await importClaudeAi(a.ctx, [two]);
    await importClaudeAi(b.ctx, [two]);
    await importClaudeAi(b.ctx, [one]);
    const state = (ctx: HansardContext) =>
      rows(ctx, 'select id, content, source_updated_at, timestamp from events order by id');
    expect(state(a.ctx)).toEqual(state(b.ctx));
    const titles = (ctx: HansardContext) => rows(ctx, 'select id, title, event_count from sessions order by id');
    expect(titles(a.ctx)).toEqual(titles(b.ctx));
  });

  it('resolves a manifest, skips other parts, warns on a missing part and exits non-zero via the report', async () => {
    const m = makeMachine();
    const dir = tempDir();
    await exportZip(dir, 'data-batch-0000.zip', sampleExport());
    await writeZip(path.join(dir, 'projects-batch-0000.zip'), { 'projects.json': '[]' });
    const manifest = {
      instructions: 'demo',
      created_at: ISO(0),
      total_files: 3,
      version: 1,
      data_files: [
        { batch_index: 0, export_url: 'https://example.com/never-fetched-0', category: 'conversations', part: 0, filename: 'data-batch-0000.zip' },
        { batch_index: 1, export_url: 'https://example.com/never-fetched-1', category: 'projects', part: 0, filename: 'projects-batch-0000.zip' },
        { batch_index: 2, export_url: 'https://example.com/never-fetched-2', category: 'conversations', part: 1, filename: 'data-batch-0001.zip' },
      ],
    };
    const manifestPath = path.join(dir, 'export.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const report = await importClaudeAi(m.ctx, [manifestPath]);
    expect(report.imported).toBe(1);
    expect(report.infos).toContain('skipped projects part (no adapter yet)');
    expect(report.missingConversationsParts).toBe(1);
    expect(report.warnings.some((w) => w.includes('data-batch-0001.zip: listed in manifest but missing'))).toBe(true);
    expect(report.warnings.join('\n')).not.toContain(dir);
  });

  it('accepts a directory of zips and classifies parts by their entries', async () => {
    const m = makeMachine();
    const dir = tempDir();
    await exportZip(dir, 'a.zip', sampleExport());
    await writeZip(path.join(dir, 'memories_part.zip'), { 'memories.json': '[]' });
    await writeZip(path.join(dir, 'other.zip'), { 'something.json': '[]' });
    const report = await importClaudeAi(m.ctx, [dir]);
    expect(report.imported).toBe(1);
    expect(report.infos.filter((i) => i.startsWith('skipped'))).toHaveLength(2);
  });

  it('refuses manifest entries outside their directory and reports unreadable zips', async () => {
    const m = makeMachine();
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'bad.zip'), 'not a zip');
    fs.writeFileSync(
      path.join(dir, 'm.json'),
      JSON.stringify({ data_files: [{ category: 'conversations', filename: '../escape.zip' }] }),
    );
    const manifestReport = await importClaudeAi(m.ctx, [path.join(dir, 'm.json')]);
    expect(manifestReport.failed).toBe(1);
    const zipReport = await importClaudeAi(m.ctx, [path.join(dir, 'bad.zip')]);
    expect(zipReport.failed).toBe(1);
    expect(zipReport.warnings[0]).toContain('not a readable zip');
  });

  it('two machines sharing one archive both see imported sessions, also after rebuild', async () => {
    const archiveRoot = path.join(tempDir(), 'shared-archive');
    const a = makeMachine({ archiveRoot });
    const b = makeMachine({ archiveRoot });
    await importClaudeAi(a.ctx, [await exportZip(tempDir(), 'one.zip', sampleExport())]);
    await ingestAll(b.ctx);
    const ids = (ctx: HansardContext) => ({
      events: rows(ctx, 'select id from events order by id').map((r) => r['id']),
      sessions: rows(ctx, 'select id, machine_id from sessions order by id'),
    });
    expect(ids(b.ctx).events).toHaveLength(9);
    expect(ids(a.ctx)).toEqual(ids(b.ctx));
    expect(ids(b.ctx).sessions.every((s) => s['machine_id'] === a.ctx.machineId)).toBe(true);
    await rebuild(a.ctx);
    await rebuild(b.ctx);
    expect(ids(a.ctx)).toEqual(ids(b.ctx));
    expect(ids(a.ctx).events).toHaveLength(9);
    expect(rows(a.ctx, 'select count(*) as n from imports')[0]?.['n']).toBe(1);
  });

  it('skips an archived zip whose sidecar has not synced yet', async () => {
    const archiveRoot = path.join(tempDir(), 'shared-archive');
    const a = makeMachine({ archiveRoot });
    const b = makeMachine({ archiveRoot });
    await importClaudeAi(a.ctx, [await exportZip(tempDir(), 'one.zip', sampleExport())]);
    const dir = path.join(archiveRoot, 'raw', 'claude-ai');
    const sidecar = fs.readdirSync(dir).find((n) => n.endsWith('.json')) as string;
    fs.renameSync(path.join(dir, sidecar), path.join(dir, `${sidecar}.hold`));
    const held = await ingestAll(b.ctx);
    expect(held.warnings.some((w) => w.includes('sidecar missing'))).toBe(true);
    expect(rows(b.ctx, 'select count(*) as n from events')[0]?.['n']).toBe(0);
    fs.renameSync(path.join(dir, `${sidecar}.hold`), path.join(dir, sidecar));
    await ingestAll(b.ctx);
    expect(rows(b.ctx, 'select count(*) as n from events')[0]?.['n']).toBe(9);
  });

  it('is searchable by source, redacts, and respects session exclusions', async () => {
    const m = makeMachine();
    const secret = ['sk-', 'ant-', 'abCD'.repeat(6)].join('');
    const data = [
      conversation(C1, 'Secrets chat', [message('s-1', 'human', 1, { content: [textBlock(`please rotate ${secret} now`, 1)] })]),
      ...sampleExport().slice(1),
    ];
    await importClaudeAi(m.ctx, [await exportZip(tempDir(), 'x.zip', data)]);
    const db = openDb(m.ctx.dbPath);
    try {
      expect(search(db, { query: 'rotate', source: 'claude-ai' })).toHaveLength(1);
      expect(search(db, { query: 'rotate', source: 'claude-code' })).toHaveLength(0);
      expect(search(db, { query: secret })).toHaveLength(0);
      expect(JSON.stringify(search(db, { query: 'rotate' }))).not.toContain(secret);
      expect(search(db, { query: 'fallback' }).map((h) => h.session_id)).toEqual([C2]);
      changeExclusion(m.ctx, db, 'add', { kind: 'session', value: C2 });
      expect(search(db, { query: 'fallback' })).toHaveLength(0);
      changeExclusion(m.ctx, db, 'add', { kind: 'project', value: '**' });
      expect(listSessions(db).length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import { claudeAiFixtures } from '@hansard/core';
import { sandbox } from './helpers.js';

function writeZip(file: string, entries: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const [name, body] of Object.entries(entries)) zip.addBuffer(Buffer.from(body), name);
    zip.end();
    const out = fs.createWriteStream(file);
    out.on('close', () => resolve());
    out.on('error', reject);
    zip.outputStream.pipe(out);
  });
}

describe('import claude-ai', () => {
  it('imports a zip, then reports it as already imported, and the data is searchable', async () => {
    const box = sandbox();
    const zip = path.join(box.base, 'export.zip');
    await writeZip(zip, { 'conversations.json': JSON.stringify(claudeAiFixtures.sampleExport()) });
    const first = await box.cli('import', 'claude-ai', zip);
    expect(first.code).toBe(0);
    expect(first.out).toContain('imported 1 exports, 3 new conversations, 9 new events, 0 updated events, 0 already imported');
    expect(first.out + first.err).not.toContain(box.base);
    expect(first.out).not.toContain('progress');
    const second = await box.cli('import', 'claude-ai', zip);
    expect(second.code).toBe(0);
    expect(second.out).toContain('already imported export.zip');
    expect(second.out).toContain('imported 0 exports');
    const found = await box.cli('search', 'caching', '--source', 'claude-ai');
    expect(found.out.trim().split('\n').length).toBeGreaterThan(0);
    expect((await box.cli('sessions', '--source', 'claude-ai')).out.trim().split('\n')).toHaveLength(3);
  });

  it('exits 1 when a manifest part is missing and 2 on usage errors', async () => {
    const box = sandbox();
    const manifest = path.join(box.base, 'export.json');
    fs.writeFileSync(
      manifest,
      JSON.stringify({ data_files: [{ category: 'conversations', filename: 'gone.zip', export_url: 'https://example.com/x' }] }),
    );
    const r = await box.cli('import', 'claude-ai', manifest);
    expect(r.code).toBe(1);
    expect(r.err).toContain('gone.zip: listed in manifest but missing');
    expect((await box.cli('import', 'claude-ai')).code).toBe(2);
    expect((await box.cli('import', 'chatgpt', 'x')).code).toBe(2);
    expect((await box.cli('import')).code).toBe(2);
  });

  it('prints progress every 100 conversations', async () => {
    const box = sandbox();
    const many = Array.from({ length: 120 }, (_, i) => ({
      uuid: `c-${i}`,
      name: `Demo conversation ${i}`,
      created_at: '2026-01-01T00:00:00.000000Z',
      updated_at: '2026-01-01T00:00:00.000000Z',
      chat_messages: [],
    }));
    const zip = path.join(box.base, 'many.zip');
    await writeZip(zip, { 'conversations.json': JSON.stringify(many) });
    const r = await box.cli('import', 'claude-ai', zip);
    expect(r.out).toContain('progress 100 conversations');
    expect(r.out).not.toContain('progress 200');
  });
});

describe('claude-ai source status', () => {
  it('reports not found before any import, found after, and doctor stays ok', async () => {
    const box = sandbox();
    expect((await box.cli('sources')).out).toMatch(/^claude-ai {2}import {2}found no /m);
    const before = await box.cli('doctor');
    expect(before.code).toBe(0);
    expect(before.out).toMatch(/^ok {4}source claude-ai: no exports imported yet$/m);
    const zip = path.join(box.base, 'export.zip');
    await writeZip(zip, { 'conversations.json': JSON.stringify(claudeAiFixtures.sampleExport()) });
    await box.cli('import', 'claude-ai', zip);
    expect((await box.cli('sources')).out).toMatch(/^claude-ai {2}import {2}found yes /m);
    expect((await box.cli('doctor')).out).toMatch(/^ok {4}source claude-ai: found$/m);
  });
});

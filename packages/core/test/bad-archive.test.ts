import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { importClaudeAi, ingestAll, openDb, rebuild } from '../src/index.js';
import { sampleExport } from '../src/adapters/claude-ai/fixtures.js';
import { userText } from '../src/adapters/claude-code/fixtures.js';
import { makeMachine, tempDir, writeSession } from './helpers.js';
import { writeZip } from './zip.js';

const SID = '55555555-5555-4555-8555-555555555555';
const SHA = 'a'.repeat(64);

// A zip whose central directory is fine but whose conversations.json is cut off mid array.
const brokenZip = async (file: string) => writeZip(file, { 'conversations.json': '[{"uuid": "c-1", "name": ' });

function plantBadArchiveZip(archiveRoot: string): string {
  const dir = path.join(archiveRoot, 'raw', 'claude-ai');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${SHA}.json`), JSON.stringify({ sha256: SHA, machine_id: 'other-machine', original_name: 'x.zip', imported_at: 'now' }));
  fs.writeFileSync(path.join(dir, `${SHA}.zip`), 'this is not a zip at all');
  return dir;
}

describe('one bad archive file', () => {
  it('does not stop other files from ingesting, and is reported once with a relative path', async () => {
    const m = makeMachine();
    writeSession(m.claudeRoot, SID, userText({ sessionId: SID, uuid: 'u1', timestamp: '2026-01-01T10:00:00.000Z' }, 'still ingested'));
    plantBadArchiveZip(m.ctx.archiveRoot);
    const result = await ingestAll(m.ctx);
    expect(result.failedFiles).toBe(1);
    expect(result.warnings).toContain(`raw/claude-ai/${SHA}.zip: ingest failed, skipped`);
    expect(result.warnings.join('\n')).not.toContain(m.ctx.home);
    expect(result.newEvents).toBe(1);
  });

  it('does not stop rebuild', async () => {
    const m = makeMachine();
    writeSession(m.claudeRoot, SID, userText({ sessionId: SID, uuid: 'u1', timestamp: '2026-01-01T10:00:00.000Z' }, 'kept'));
    await ingestAll(m.ctx);
    plantBadArchiveZip(m.ctx.archiveRoot);
    const rebuilt = await rebuild(m.ctx);
    expect(rebuilt.failedFiles).toBe(1);
    expect(rebuilt.events).toBe(1);
  });

  it('a failed file is not marked done, so it is retried next run', async () => {
    const m = makeMachine();
    plantBadArchiveZip(m.ctx.archiveRoot);
    await ingestAll(m.ctx);
    expect((await ingestAll(m.ctx)).failedFiles).toBe(1);
    const db = openDb(m.ctx.dbPath);
    expect(db.prepare('select count(*) as n from ingest_state').get()).toEqual({ n: 0 });
    db.close();
  });
});

describe('importing a corrupt export', () => {
  it('leaves the archive untouched and records nothing', async () => {
    const m = makeMachine();
    const zip = path.join(tempDir(), 'broken.zip');
    await brokenZip(zip);
    const report = await importClaudeAi(m.ctx, [zip]);
    expect(report.failed).toBe(1);
    expect(report.imported).toBe(0);
    expect(report.warnings).toContain('broken.zip: not a valid conversations export, not imported');
    const dir = path.join(m.ctx.archiveRoot, 'raw', 'claude-ai');
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
    const db = openDb(m.ctx.dbPath);
    expect(db.prepare('select count(*) as n from imports').get()).toEqual({ n: 0 });
    db.close();
  });

  it('still imports the good exports in the same run', async () => {
    const m = makeMachine();
    const dir = tempDir();
    await brokenZip(path.join(dir, 'a-broken.zip'));
    await writeZip(path.join(dir, 'b-good.zip'), { 'conversations.json': JSON.stringify(sampleExport()) });
    const report = await importClaudeAi(m.ctx, [dir]);
    expect(report).toMatchObject({ imported: 1, failed: 1, newEvents: 9 });
  });
});

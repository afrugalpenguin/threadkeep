import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { withLock, loadContext } from 'threadkeep-core';
import { sandbox, seed } from './helpers.js';

describe('cli basics', () => {
  it('prints help and rejects unknown commands and bad flags with exit 2', async () => {
    const box = sandbox();
    expect((await box.cli('--help')).code).toBe(0);
    expect((await box.cli()).code).toBe(2);
    const unknown = await box.cli('frobnicate');
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('unknown command');
    expect((await box.cli('search')).code).toBe(2);
    expect((await box.cli('sessions', '--bogus')).code).toBe(2);
    expect((await box.cli('sessions', '--sort', 'sideways')).code).toBe(2);
    expect((await box.cli('search', 'x', '--since', 'yesterday')).code).toBe(2);
  });

  it('creates config on first run and says where, using a home-relative path', async () => {
    const box = sandbox();
    const first = await box.cli('sessions', '--home', box.home);
    expect(first.code).toBe(0);
    expect(first.err).toContain('created config at <home>/config.json');
    expect(first.err).not.toContain(box.base);
    expect(fs.existsSync(path.join(box.home, 'config.json'))).toBe(true);
    expect((await box.cli('sessions')).err).toBe('');
  });
});

describe('ingest, search, sessions, show', () => {
  it('ingests fixture data and reports counts without absolute paths', async () => {
    const box = sandbox();
    seed(box, 3);
    const r = await box.cli('ingest');
    expect(r.code).toBe(0);
    expect(r.out).toContain('mirrored 3 files');
    expect(r.out).toContain('ingested 3 files, 9 new events');
    expect(r.out).toContain('progress 3/3 files');
    expect(r.out + r.err).not.toContain(box.base);
    const again = await box.cli('ingest');
    expect(again.out).toContain('ingested 0 files, 0 new events');
  });

  it('ingests a single path and fails closed outside the roots', async () => {
    const box = sandbox();
    const [id] = seed(box, 1);
    const file = path.join(box.claudeRoot, '-home-alice-projects-demo', `${id}.jsonl`);
    const ok = await box.cli('ingest', file);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('3 new events');
    const bad = await box.cli('ingest', path.join(box.userHome, 'other.jsonl'));
    expect(bad.code).toBe(1);
    expect(bad.err).not.toContain(box.base);
    expect((await box.cli('ingest', 'a', 'b')).code).toBe(2);
  });

  it('exits 3 when the ingest lock is held', async () => {
    const box = sandbox();
    seed(box, 1);
    await box.cli('sessions');
    const ctx = loadContext({ home: box.home, userHome: box.userHome, env: {} });
    await withLock(ctx, { waitMs: 0 }, async () => {
      const r = await box.cli('ingest', '--wait', '250');
      expect(r.code).toBe(3);
      expect(r.err).toContain('busy');
    });
  });

  it('searches with default, json and filtered output', async () => {
    const box = sandbox();
    seed(box, 2);
    await box.cli('ingest');
    const r = await box.cli('search', 'conversation', '1', 'answer');
    expect(r.code).toBe(0);
    const lines = r.out.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^2026-01-01 10:00 {2}[0-9a-f]{8} {2}assistant {2}demo {2}.*answer/)
    expect(r.out).not.toContain('/home/alice');
    const json = JSON.parse((await box.cli('search', 'conversation', '--json')).out) as { session_id: string }[];
    expect(json.length).toBeGreaterThan(0);
    expect((await box.cli('search', 'conversation', '--source', 'claude-ai')).out).toBe('');
    expect((await box.cli('search', 'conversation', '--role', 'user', '--limit', '1', '--sort', 'time')).out.trim().split('\n')).toHaveLength(1);
    expect((await box.cli('search', '"', '--thinking')).code).toBe(0);
  });

  it('labels system generated messages as system in search and show', async () => {
    const box = sandbox();
    const sid = 'cccccccc-1111-4111-8111-111111111111';
    const dir = path.join(box.claudeRoot, '-home-alice-projects-demo');
    fs.mkdirSync(dir, { recursive: true });
    const row = (uuid: string, content: string) =>
      JSON.stringify({ type: 'user', uuid, sessionId: sid, timestamp: '2026-01-01T10:00:00.000Z', cwd: '/home/alice/projects/demo', message: { role: 'user', content } }) + '\n';
    fs.writeFileSync(path.join(dir, `${sid}.jsonl`), row('s1', '<task-notification>narwhal done</task-notification>') + row('s2', 'a human prompt'));
    await box.cli('ingest');
    const hits = await box.cli('search', 'narwhal', '--role', 'system');
    expect(hits.out).toMatch(/ {2}system {2}/);
    expect((await box.cli('search', 'narwhal', '--role', 'user')).out).toBe('');
    const shown = await box.cli('show', sid.slice(0, 8));
    expect(shown.out).toContain('] system\n');
    expect(shown.out).toContain('] user\n');
  });

  it('lists sessions with the documented columns', async () => {
    const box = sandbox();
    seed(box, 2);
    await box.cli('ingest');
    const r = await box.cli('sessions');
    const rows = r.out.trim().split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^2026-01-02 10:00 {2}[0-9a-f]{8} {2}claude-code {2}[0-9a-f]{8} {2}3 {2}demo {2}Demo conversation 2$/);
    const json = JSON.parse((await box.cli('sessions', '--json', '--sort', 'length', '--limit', '1')).out) as unknown[];
    expect(json).toHaveLength(1);
    expect((await box.cli('sessions', '--machine', 'unknown-machine')).out).toBe('');
  });

  it('shows a session by prefix, expands tools, and exits 1 for unknown or ambiguous ids', async () => {
    const box = sandbox();
    const [id] = seed(box, 2);
    await box.cli('ingest');
    const plain = await box.cli('show', (id as string).slice(0, 8));
    expect(plain.code).toBe(0);
    expect(plain.out).toContain('Demo conversation');
    expect(plain.out).not.toContain('demo file body');
    const expanded = await box.cli('show', id as string, '--expand-tools');
    expect(expanded.out).toContain('demo file body');
    const json = JSON.parse((await box.cli('show', id as string, '--json')).out) as { events: unknown[] };
    expect(json.events).toHaveLength(3);
    const missing = await box.cli('show', 'deadbeef');
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('session not found');
    expect((await box.cli('show')).code).toBe(2);
    expect((await box.cli('show', '')).code).toBe(1);
  });
});

describe('failed archive files', () => {
  it('finishes the run, then exits 1', async () => {
    const box = sandbox();
    seed(box, 1);
    const sha = 'b'.repeat(64);
    const dir = path.join(box.home, 'archive', 'raw', 'claude-ai');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sha}.json`), JSON.stringify({ sha256: sha, machine_id: 'm', original_name: 'x.zip', imported_at: 'n' }));
    fs.writeFileSync(path.join(dir, `${sha}.zip`), 'not a zip');
    const r = await box.cli('ingest');
    expect(r.code).toBe(1);
    expect(r.out).toContain('3 new events');
    expect(r.err).toContain(`raw/claude-ai/${sha}.zip: ingest failed, skipped`);
    expect((await box.cli('rebuild')).code).toBe(1);
  });
});

describe('error output', () => {
  it('never prints absolute paths, even for raw filesystem errors', async () => {
    const box = sandbox();
    seed(box, 1);
    await box.cli('sessions');
    fs.writeFileSync(path.join(box.home, 'archive'), 'a file, not a directory');
    const r = await box.cli('ingest');
    expect(r.code).toBe(1);
    expect(r.err).toContain('error: EEXIST mkdir <archive>');
    expect(r.err).not.toContain(box.base);
    expect((await box.cli('rebuild')).err).not.toContain(box.base);
  });
});

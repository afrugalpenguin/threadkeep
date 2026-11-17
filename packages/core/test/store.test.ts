import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BusyError, loadContext, openDb, schemaVersion, withLock, displayPath, setMachineLabel } from '../src/index.js';
import { makeMachine, tempDir } from './helpers.js';

describe('config', () => {
  it('creates defaults on first run and never regenerates the machine id', () => {
    const base = tempDir();
    const options = { home: path.join(base, 'home'), userHome: path.join(base, 'user'), env: {} };
    const first = loadContext(options);
    expect(first.created).toEqual(['<home>/config.json', '<home>/exclusions.json', '<home>/machine.json']);
    const second = loadContext(options);
    expect(second.created).toEqual([]);
    expect(second.machineId).toBe(first.machineId);
    const config = JSON.parse(fs.readFileSync(first.configPath, 'utf8'));
    expect(config.sources['claude-code'].root).toBe('~/.claude/projects');
    expect(fs.readFileSync(first.configPath, 'utf8')).not.toContain(base);
    expect(first.sources['claude-code']?.root).toBe(path.join(base, 'user', '.claude', 'projects'));
    expect(JSON.parse(fs.readFileSync(first.exclusionsPath, 'utf8'))).toEqual({ projectGlobs: [], sessionIds: [] });
  });

  it('prefers THREADKEEP_HOME from the injected env', () => {
    const base = tempDir();
    const ctx = loadContext({ env: { THREADKEEP_HOME: path.join(base, 'h') }, userHome: path.join(base, 'u') });
    expect(ctx.home).toBe(path.join(base, 'h'));
  });

  it('displays paths without absolute locations', () => {
    const { ctx } = makeMachine();
    expect(displayPath(ctx, ctx.dbPath)).toBe('<home>/history.db');
    expect(displayPath(ctx, path.join(ctx.archiveRoot, 'raw', 'x'))).toBe('<archive>/raw/x');
    expect(displayPath(ctx, path.join(path.parse(ctx.home).root, 'elsewhere', 'file.txt'))).toBe('<external>/file.txt');
  });

  it('writes the machine label to the archive', () => {
    const { ctx } = makeMachine();
    setMachineLabel(ctx, 'laptop');
    const file = path.join(ctx.archiveRoot, 'machines', `${ctx.machineId}.json`);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ id: ctx.machineId, label: 'laptop' });
  });
});

describe('store', () => {
  it('opens with wal, foreign keys and the current schema, idempotently', () => {
    const { ctx } = makeMachine();
    const db = openDb(ctx.dbPath);
    expect(schemaVersion(db)).toBe(2);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
    const again = openDb(ctx.dbPath);
    expect(schemaVersion(again)).toBe(2);
    expect(again.prepare('select count(*) as n from schema_version').get()).toEqual({ n: 2 });
    again.close();
  });

  it('keeps fts in sync through insert, update and delete', () => {
    const { ctx } = makeMachine();
    const db = openDb(ctx.dbPath);
    db.prepare(
      "insert into events (id, source, machine_id, session_id, role, kind, content_redacted) values ('e1', 's', 'm', 'x', 'user', 'text', 'hello world')",
    ).run();
    const hits = (q: string) => db.prepare('select rowid from events_fts where events_fts match ?').all(q).length;
    expect(hits('hello')).toBe(1);
    db.prepare("update events set content_redacted = 'goodbye' where id = 'e1'").run();
    expect(hits('hello')).toBe(0);
    expect(hits('goodbye')).toBe(1);
    db.prepare("delete from events where id = 'e1'").run();
    expect(hits('goodbye')).toBe(0);
    db.close();
  });

  it('enforces the decision status check', () => {
    const { ctx } = makeMachine();
    const db = openDb(ctx.dbPath);
    expect(() => db.prepare("insert into decisions (id, status) values ('d', 'bogus')").run()).toThrow();
    db.close();
  });
});

describe('lock', () => {
  it('times out as busy when held and releases afterwards', async () => {
    const { ctx } = makeMachine();
    await withLock(ctx, { waitMs: 0 }, async () => {
      await expect(withLock(ctx, { waitMs: 250 }, () => 1)).rejects.toBeInstanceOf(BusyError);
    });
    expect(fs.existsSync(ctx.lockPath)).toBe(false);
  });

  it('takes over a lock whose pid is dead and warns', async () => {
    const { ctx } = makeMachine();
    fs.writeFileSync(ctx.lockPath, `2147483646 ${Date.now()}\n`);
    const warnings: string[] = [];
    const result = await withLock(ctx, { waitMs: 1000, onWarning: (w) => warnings.push(w) }, () => 'ok');
    expect(result).toBe('ok');
    expect(warnings).toHaveLength(1);
  });

  it('takes over a lock older than ten minutes', async () => {
    const { ctx } = makeMachine();
    fs.writeFileSync(ctx.lockPath, `${process.pid} ${Date.now()} some-token
`);
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(ctx.lockPath, old, old);
    expect(await withLock(ctx, { waitMs: 1000 }, () => 'ok')).toBe('ok');
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { openerFor } from '../src/commands/ui.js';
import { sandbox, seed, waitFor, type Sandbox } from './helpers.js';

const OPEN_LINE = /open (http:\/\/127\.0\.0\.1:\d+\/)#token=([0-9a-f]+)/;

// Starts `threadkeep ui` on an ephemeral port and returns what it printed once listening.
async function start(box: Sandbox) {
  let out = '';
  let err = '';
  const controller = new AbortController();
  const done = run(
    ['ui', '--port', '0'],
    { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
    box.env,
    controller.signal,
  );
  // The first start pays a cold import of the server package, which can be slow under a parallel full run.
  await waitFor(() => OPEN_LINE.test(out), 25_000);
  const match = OPEN_LINE.exec(out) as RegExpExecArray;
  return {
    url: match[1] as string,
    token: match[2] as string,
    out: () => out,
    err: () => err,
    stop: async () => {
      controller.abort();
      return done;
    },
  };
}

const withToken = (token: string) => ({ headers: { 'x-threadkeep-token': token } });

function setUiToken(box: Sandbox, value: unknown): void {
  fs.mkdirSync(box.home, { recursive: true });
  const file = path.join(box.home, 'config.json');
  const config = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { dbPath: '<home>/history.db', archiveRoot: '<home>/archive', sources: { 'claude-code': { root: '~/.claude/projects' } } };
  fs.writeFileSync(file, JSON.stringify({ ...config, ui: { token: value } }));
}

describe('ui', { timeout: 30_000 }, () => {
  it('prints the tokenised link, gates the api on it, and keeps paths and queries out of output', async () => {
    const box = sandbox();
    seed(box, 2);
    expect((await box.cli('ingest')).code).toBe(0);
    const ui = await start(box);
    expect(ui.out()).toMatch(/listening on http:\/\/127\.0\.0\.1:\d+\/\n/);
    expect(ui.out()).toContain('database: <home>/history.db');
    expect(ui.out()).toContain('press ctrl+c to stop');
    expect(ui.token).toHaveLength(48);
    expect((await fetch(`${ui.url}api/sessions`)).status).toBe(401);
    expect((await fetch(`${ui.url}api/sessions`, withToken('0'.repeat(48)))).status).toBe(401);
    const sessions = (await (await fetch(`${ui.url}api/sessions`, withToken(ui.token))).json()) as unknown[];
    expect(sessions).toHaveLength(2);
    await fetch(`${ui.url}api/search?q=zzsecretqueryzz`, withToken(ui.token));
    expect(await ui.stop()).toBe(0);
    expect(ui.err()).toContain('/api/search');
    expect(ui.err()).not.toContain(ui.token);
    expect(ui.out() + ui.err()).not.toContain(box.base);
    expect(ui.out() + ui.err()).not.toContain('zzsecretqueryzz');
  });

  it('uses a fixed token from config.json', async () => {
    const box = sandbox();
    const fixed = 'c'.repeat(40);
    setUiToken(box, fixed);
    const ui = await start(box);
    expect(ui.token).toBe(fixed);
    expect((await fetch(`${ui.url}api/sessions`, withToken(fixed))).status).toBe(200);
    expect(await ui.stop()).toBe(0);
  });

  it('rejects an invalid config token without echoing it', async () => {
    const box = sandbox();
    for (const bad of ['Not-Hex-Secret-0123456789abcdef0123456789', 'abc', 123]) {
      setUiToken(box, bad);
      const r = await box.cli('ui', '--port', '0');
      expect(r.code, String(bad)).not.toBe(0);
      expect(r.err).toContain('ui.token');
      expect(r.out + r.err).not.toContain(String(bad));
    }
  });

  it('rejects a config ui value that is not an object without echoing it', async () => {
    const box = sandbox();
    fs.mkdirSync(box.home, { recursive: true });
    for (const bad of ['topsecretvalue', ['topsecretvalue'], null]) {
      fs.writeFileSync(path.join(box.home, 'config.json'), JSON.stringify({ dbPath: '<home>/history.db', archiveRoot: '<home>/archive', sources: {}, ui: bad }));
      const r = await box.cli('ui', '--port', '0');
      expect(r.code, JSON.stringify(bad)).toBe(1);
      expect(r.err).toContain('ui.token');
      expect(r.out + r.err).not.toContain('topsecretvalue');
    }
  });

  it('rejects bad ports and positionals', async () => {
    const box = sandbox();
    expect((await box.cli('ui', '--port', '70000')).code).toBe(2);
    expect((await box.cli('ui', 'extra')).code).toBe(2);
  });
});

describe('browser opener', () => {
  const url = `http://127.0.0.1:4477/#token=${'a'.repeat(48)}`;

  it('keeps the whole url, fragment included, on every platform', () => {
    const win = openerFor('win32', url);
    expect(win?.command).toMatch(/System32\\cmd\.exe$/);
    expect(win?.args.join(' ')).toContain(`"${url}"`);
    expect(win?.verbatim).toBe(true);
    expect(openerFor('darwin', url)).toMatchObject({ command: 'open', args: [url] });
    expect(openerFor('linux', url)).toMatchObject({ command: 'xdg-open', args: [url] });
  });

  it('refuses anything that is not a plain loopback link, so nothing reaches cmd.exe', () => {
    for (const bad of ['http://evil.example/', `${url}&calc`, `${url}"`, 'http://127.0.0.1:4477/#token=%PATH%', 'file:///c:/x']) {
      expect(openerFor('win32', bad), bad).toBeNull();
    }
  });
});

describe('doctor ui token', () => {
  it('reports per run by default, fixed when configured, and fails on an invalid value', async () => {
    const box = sandbox();
    expect((await box.cli('doctor')).out).toMatch(/^ok {4}ui token: per run$/m);
    setUiToken(box, 'd'.repeat(40));
    const fixed = await box.cli('doctor');
    expect(fixed.out).toMatch(/^ok {4}ui token: fixed \(config\)$/m);
    expect(fixed.out).not.toContain('d'.repeat(40));
    setUiToken(box, 'nope-secret-value');
    const bad = await box.cli('doctor');
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/^fail {2}ui token:.*ui\.token/m);
    expect(bad.out).not.toContain('nope-secret-value');
  });
});

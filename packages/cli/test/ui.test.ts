import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { openerFor } from '../src/commands/ui.js';
import { sandbox, seed, waitFor, type Sandbox } from './helpers.js';

const OPEN_LINE = /open (http:\/\/127\.0\.0\.1:\d+\/)#token=([0-9a-f]+)/;

// Starts `hansard ui` on an ephemeral port and returns what it printed once listening.
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
  await waitFor(() => OPEN_LINE.test(out));
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

const withToken = (token: string) => ({ headers: { 'x-hansard-token': token } });

describe('ui', () => {
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
    expect(win?.command).toBe('cmd.exe');
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

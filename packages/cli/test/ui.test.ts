import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { sandbox, seed, waitFor } from './helpers.js';

describe('ui', () => {
  it('serves the api on loopback until aborted and keeps paths and queries out of output', async () => {
    const box = sandbox();
    seed(box, 2);
    expect((await box.cli('ingest')).code).toBe(0);
    let out = '';
    let err = '';
    const controller = new AbortController();
    const done = run(
      ['ui', '--port', '0'],
      { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
      box.env,
      controller.signal,
    );
    await waitFor(() => /listening on http:\/\/127\.0\.0\.1:\d+\//.test(out));
    const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(out)?.[0] as string;
    const sessions = (await (await fetch(`${url}api/sessions`)).json()) as unknown[];
    expect(sessions).toHaveLength(2);
    await fetch(`${url}api/search?q=zzsecretqueryzz`);
    controller.abort();
    expect(await done).toBe(0);
    expect(err).toContain('/api/search');
    expect(out + err).not.toContain(box.base);
    expect(out + err).not.toContain('zzsecretqueryzz');
  });

  it('rejects bad ports and positionals', async () => {
    const box = sandbox();
    expect((await box.cli('ui', '--port', '70000')).code).toBe(2);
    expect((await box.cli('ui', 'extra')).code).toBe(2);
  });
});

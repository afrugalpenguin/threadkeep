import { afterEach, describe, expect, it } from 'vitest';
import { HOST, S1, TOKEN, seededApp } from './helpers.js';

const apps: { close(): Promise<unknown> }[] = [];
// Must run before the core helper's temp-dir cleanup (vitest runs afterEach hooks in reverse registration order) so Windows can delete the db file.
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});
async function setup() {
  const s = await seededApp();
  apps.push(s.app);
  return s;
}

const READS = ['/api/sessions', '/api/search?q=visible', `/api/sessions/${S1}`, '/api/facets', '/api/decisions', '/api/nope'];

describe('read token', () => {
  it('rejects every api read without a token or with a wrong one, and accepts the right one', async () => {
    const { app } = await setup();
    for (const url of READS) {
      for (const headers of [{ host: HOST }, { host: HOST, 'x-hansard-token': 'wrong' }, { host: HOST, 'x-hansard-token': TOKEN.slice(1) }]) {
        const res = await app.inject({ url, headers });
        expect(res.statusCode, url).toBe(401);
        expect(res.json(), url).toEqual({ error: 'missing or invalid token' });
        expect(res.headers['content-security-policy'], url).toContain("default-src 'none'");
        expect(res.headers['cache-control'], url).toBe('no-store');
      }
      const ok = await app.inject({ url, headers: { host: HOST, 'x-hansard-token': TOKEN } });
      expect(ok.statusCode, url).toBe(url === '/api/nope' ? 404 : 200);
    }
  });

  it('applies to HEAD and to the decisions write', async () => {
    const { app } = await setup();
    for (const url of READS.slice(0, 5)) {
      expect((await app.inject({ method: 'HEAD', url, headers: { host: HOST } })).statusCode, url).toBe(401);
      expect((await app.inject({ method: 'HEAD', url, headers: { host: HOST, 'x-hansard-token': TOKEN } })).statusCode, url).toBe(200);
    }
    const post = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/api/decisions/d1/status',
        headers: { host: HOST, 'content-type': 'application/json', ...headers },
        payload: JSON.stringify({ status: 'confirmed' }),
      });
    expect((await post({})).statusCode).toBe(401);
    expect((await post({ 'x-hansard-token': TOKEN })).statusCode).toBe(200);
  });

  it('cannot be bypassed with an encoded or oddly cased path', async () => {
    const { app } = await setup();
    for (const url of ['/%61pi/sessions', '/API/sessions', '//api/sessions', '/api/sessions/../sessions', '/api%2Fsessions']) {
      const res = await app.inject({ url, headers: { host: HOST } });
      expect(res.statusCode, url).not.toBe(200);
      expect(res.body, url).not.toContain(S1);
    }
  });

  it('answers 401 before any body or content-type handling', async () => {
    const { app } = await setup();
    const post = (headers: Record<string, string>, payload: string) =>
      app.inject({ method: 'POST', url: '/api/decisions/d1/status', headers: { host: HOST, ...headers }, payload });
    const badBody = await post({ 'content-type': 'application/json' }, '{"status":["x"]}');
    expect(badBody.statusCode).toBe(401);
    expect(badBody.json()).toEqual({ error: 'missing or invalid token' });
    expect((await post({ 'content-type': 'text/plain' }, '{"status":"confirmed"}')).statusCode).toBe(401);
    expect((await post({ 'content-type': 'application/x-www-form-urlencoded' }, 'status=confirmed')).statusCode).toBe(401);
  });

  it('checks the host before the token', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: '/api/sessions', headers: { host: 'evil.example:4477' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden host' });
  });

  it('keeps the page and static files open, and other non-read methods need the token', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/', headers: { host: HOST } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/app.js', headers: { host: HOST } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/', headers: { host: HOST } })).statusCode).toBe(403);
  });

  it('logs method, route and status only, never the token', async () => {
    const { app, lines } = await setup();
    await app.inject({ url: '/api/sessions', headers: { host: HOST } });
    await app.inject({ url: '/api/search?q=visible', headers: { host: HOST, 'x-hansard-token': TOKEN } });
    expect(lines).toContain('GET /api/sessions 401');
    expect(lines).toContain('GET /api/search 200');
    expect(lines.join('\n')).not.toContain(TOKEN);
  });
});

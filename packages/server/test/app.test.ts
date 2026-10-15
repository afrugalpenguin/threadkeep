import { afterEach, describe, expect, it } from 'vitest';
import { HOST, TOKEN, seededApp } from './helpers.js';

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});
async function setup() {
  const s = await seededApp();
  apps.push(s.app);
  return s;
}

describe('host guard', () => {
  it('accepts loopback hosts on the bound port and rejects everything else', async () => {
    const { app } = await setup();
    for (const host of [HOST, 'localhost:4477']) {
      expect((await app.inject({ url: '/', headers: { host } })).statusCode).toBe(200);
    }
    for (const host of ['evil.example:4477', '127.0.0.1:9999', 'localhost', '']) {
      const res = await app.inject({ url: '/api/sessions', headers: { host } });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('index page', () => {
  it('embeds the token, sets a strict CSP and sends no CORS headers', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: '/', headers: { host: HOST, origin: 'http://evil.example' } });
    expect(res.body).toContain(`<meta name="hansard-token" content="${TOKEN}">`);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves only the known static files and 404s when the bundle is missing', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/app.js', headers: { host: HOST } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/../package.json', headers: { host: HOST } })).statusCode).toBe(404);
  });
});

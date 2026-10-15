import { afterEach, describe, expect, it } from 'vitest';
import { applyExclusions, openDb } from '@hansard/core';
import { HOST, S2, TOKEN, seededApp } from './helpers.js';

const apps: { close(): Promise<unknown> }[] = [];
// Must run before the core helper's temp-dir cleanup (vitest runs afterEach hooks in reverse registration order) so Windows can delete the db file.
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function setup() {
  const s = await seededApp();
  apps.push(s.app);
  const post = (id: string, body: unknown, headers: Record<string, string> = {}) =>
    s.app.inject({
      method: 'POST',
      url: `/api/decisions/${id}/status`,
      headers: { host: HOST, 'content-type': 'application/json', ...headers },
      payload: JSON.stringify(body),
    });
  return { ...s, post };
}

describe('decision status writes', () => {
  it('requires the token', async () => {
    const { post } = await setup();
    expect((await post('d1', { status: 'confirmed' })).statusCode).toBe(403);
    expect((await post('d1', { status: 'confirmed' }, { 'x-hansard-token': 'wrong' })).statusCode).toBe(403);
    expect((await post('d1', { status: 'confirmed' }, { 'x-hansard-token': TOKEN })).json()).toMatchObject({ id: 'd1', status: 'confirmed' });
  });

  it('rejects form posts, bad bodies, repeats, unknown and excluded ids', async () => {
    const { app, post, m } = await setup();
    const auth = { 'x-hansard-token': TOKEN };
    const form = await app.inject({
      method: 'POST',
      url: '/api/decisions/d1/status',
      headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', ...auth },
      payload: 'status=confirmed',
    });
    expect(form.statusCode).toBe(415);
    expect((await post('d1', { status: 'proposed' }, auth)).statusCode).toBe(400);
    expect((await post('d1', { status: 'confirmed', extra: 1 }, auth)).statusCode).toBe(400);
    expect((await post('d1', { status: 'dismissed' }, auth)).statusCode).toBe(200);
    expect((await post('d1', { status: 'confirmed' }, auth)).statusCode).toBe(400);
    expect((await post('nope', { status: 'confirmed' }, auth)).statusCode).toBe(404);
    const db = openDb(m.ctx.dbPath);
    applyExclusions(db, { projectGlobs: [], sessionIds: [S2] });
    db.close();
    expect((await post('d2', { status: 'confirmed' }, auth)).statusCode).toBe(404);
  });
});

describe('error responses on writes', () => {
  it('sends a bare 415 with security headers', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/decisions/d1/status',
      headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', 'x-hansard-token': TOKEN },
      payload: 'status=confirmed',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({ error: 'bad request' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('stricter body handling', () => {
  it('rejects an array where a string is expected and text/plain posts', async () => {
    const { app, post } = await setup();
    const auth = { 'x-hansard-token': TOKEN };
    expect((await post('d1', { status: ['dismissed'] }, auth)).statusCode).toBe(400);
    const plain = await app.inject({
      method: 'POST',
      url: '/api/decisions/d1/status',
      headers: { host: HOST, 'content-type': 'text/plain', ...auth },
      payload: '{"status":"dismissed"}',
    });
    expect(plain.statusCode).toBe(415);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { applyExclusions, openDb } from 'threadkeep-core';
import { MARK_CLOSE, MARK_OPEN } from '../src/shared/marks.js';
import { ingestAll } from 'threadkeep-core';
import { userText } from '../../core/src/adapters/claude-code/fixtures.js';
import { writeSession } from '../../core/test/helpers.js';
import { AUTH, HOST, S1, S2, SECRET, seededApp } from './helpers.js';

const apps: { close(): Promise<unknown> }[] = [];
// Must run before the core helper's temp-dir cleanup (vitest runs afterEach hooks in reverse registration order) so Windows can delete the db file.
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function setup(options: { exclude?: boolean } = {}) {
  const s = await seededApp();
  apps.push(s.app);
  if (options.exclude) {
    const db = openDb(s.m.ctx.dbPath);
    applyExclusions(db, { projectGlobs: [], sessionIds: [S2] });
    db.close();
  }
  const get = async (url: string) => {
    const res = await s.app.inject({ url, headers: AUTH });
    return { status: res.statusCode, body: res.body, json: () => res.json() as never };
  };
  return { ...s, get };
}

describe('read routes', () => {
  it('lists sessions with paging and filters', async () => {
    const { get } = await setup();
    const all = (await get('/api/sessions')).json() as { id: string }[];
    expect(all.map((s) => s.id).sort()).toEqual([S1, S2].sort());
    expect(((await get('/api/sessions?limit=1&offset=1')).json() as unknown[]).length).toBe(1);
    expect(((await get('/api/sessions?project=secret')).json() as { id: string }[]).map((s) => s.id)).toEqual([S2]);
    expect((await get('/api/sessions?sort=nonsense')).status).toBe(400);
    const badSince = await get('/api/sessions?since=garbage');
    expect(badSince.status).toBe(400);
    expect(badSince.body).not.toContain('garbage');
    expect((await get('/api/sessions?limit=501')).status).toBe(400);
  });

  it('searches with control character markers', async () => {
    const { get } = await setup();
    const hits = (await get('/api/search?q=visible&role=assistant')).json() as { snippet: string }[];
    expect(hits[0]?.snippet).toContain(`${MARK_OPEN}visible${MARK_CLOSE}`);
    expect(hits[0]?.snippet).toContain('[with brackets]');
    expect((await get('/api/search')).status).toBe(400);
    expect((await get('/api/search?q=%20%20')).status).toBe(400);
    expect((await get('/api/search?q=visible&limit=501')).status).toBe(400);
  });

  it('accepts the system role in search', async () => {
    const { get, m } = await setup();
    const sid = 'eeeeeeee-3333-4333-8333-333333333333';
    const at = { sessionId: sid, uuid: 'sys1', timestamp: '2026-04-05T10:00:00.000Z' };
    writeSession(m.claudeRoot, sid, userText(at, '<task-notification>zebrafish finished</task-notification>'));
    await ingestAll(m.ctx);
    const hits = (await get('/api/search?q=zebrafish&role=system')).json() as { role: string }[];
    expect(hits.map((h) => h.role)).toEqual(['system']);
    expect(((await get('/api/search?q=zebrafish&role=user')).json() as unknown[]).length).toBe(0);
    expect((await get('/api/search?q=zebrafish&role=bogus')).status).toBe(400);
  });

  it('shows a session and maps not found and ambiguous ids', async () => {
    const { get } = await setup();
    const shown = (await get(`/api/sessions/${S1}?expandTools=true`)).json() as { session: { id: string }; events: { files_touched: string[] }[] };
    expect(shown.session.id).toBe(S1);
    expect(shown.events.some((e) => e.files_touched.length > 0)).toBe(true);
    expect((await get('/api/sessions/ffffffff')).status).toBe(404);
    expect((await get('/api/sessions/eeeeeeee')).status).toBe(409);
    expect((await get('/api/sessions/bad$id')).status).toBe(404);
  });

  it('returns facets and decisions', async () => {
    const { get } = await setup();
    const facets = (await get('/api/facets')).json() as { sources: string[] };
    expect(facets.sources).toEqual(['claude-code']);
    expect(((await get('/api/decisions?status=proposed')).json() as { id: string }[]).map((d) => d.id).sort()).toEqual(['d1', 'd2']);
    expect((await get('/api/decisions?status=bogus')).status).toBe(400);
  });
});

describe('safety across every read route', () => {
  it('shows the excluded-case data when nothing is excluded (positive control)', async () => {
    const { get } = await setup();
    expect(((await get('/api/search?q=hidden')).json() as { session_id: string }[]).map((h) => h.session_id)).toEqual([S2]);
    expect((await get('/api/facets')).body).toContain('projects/secret');
  });

  it('never returns a raw secret', async () => {
    const { get, m } = await setup();
    // Not vacuous: the raw columns really hold the secret in the user, tool input, tool output and thinking rows.
    const db = openDb(m.ctx.dbPath);
    const raw = db.prepare('select content, tool_input, tool_output from events where session_id = ?').all(S1) as Record<string, string | null>[];
    db.close();
    const holders = (column: string) => raw.filter((r) => r[column]?.includes(SECRET)).length;
    expect(holders('content'), 'raw content').toBeGreaterThanOrEqual(2);
    expect(holders('tool_input'), 'raw tool_input').toBeGreaterThanOrEqual(1);
    expect(holders('tool_output'), 'raw tool_output').toBeGreaterThanOrEqual(1);
    const urls = [
      '/api/sessions',
      '/api/search?q=visible',
      '/api/search?q=visible&thinking=true',
      '/api/search?q=key',
      '/api/search?q=considering&thinking=true',
      '/api/search?q=key&role=tool',
      `/api/sessions/${S1}`,
      `/api/sessions/${S1}?expandTools=true`,
      `/api/sessions/${S1}?thinking=true&expandTools=true`,
      '/api/facets',
      '/api/decisions',
    ];
    expect(((await get('/api/search?q=key')).json() as unknown[]).length).toBeGreaterThan(0);
    expect(((await get('/api/search?q=considering&thinking=true')).json() as unknown[]).length).toBeGreaterThan(0);
    const thinking = await get(`/api/sessions/${S1}?thinking=true&expandTools=true`);
    expect(thinking.body).toContain('considering');
    for (const url of urls) {
      const res = await get(url);
      expect(res.status, url).toBe(200);
      expect(res.body, url).not.toContain(SECRET);
    }
  });

  it('never returns an excluded session or its decisions', async () => {
    const { get } = await setup({ exclude: true });
    expect((await get('/api/sessions')).body).not.toContain(S2);
    expect((await get('/api/search?q=hidden')).json()).toEqual([]);
    expect((await get(`/api/sessions/${S2}`)).status).toBe(404);
    expect((await get('/api/facets')).body).not.toContain('projects/secret');
    expect((await get('/api/decisions')).body).not.toContain('hidden decision');
  });

  it('logs routes and statuses but never query text', async () => {
    const { get, lines } = await setup();
    await get('/api/search?q=visible');
    expect(lines).toContain('GET /api/search 200');
    expect(lines.join('\n')).not.toContain('visible');
  });

  it('turns unexpected errors into a bare 500 and logs a safe message', async () => {
    const { app, get, lines, m } = await setup();
    app.db.close();
    const res = await get('/api/sessions');
    expect(res.status).toBe(500);
    expect(res.json()).toEqual({ error: 'internal error' });
    expect(lines.join('\n')).not.toContain(m.userHome);
  });
});

describe('error responses carry no request content', () => {
  it('answers unknown routes with a bare 404 and security headers', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: '/nope?q=mysearchtext', headers: AUTH });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
    expect(res.body).not.toContain('mysearchtext');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('malformed urls', () => {
  it('logs the method and status but never the url', async () => {
    const { app, lines } = await setup();
    await app.inject({ url: '/%zz', headers: { host: HOST } });
    expect(lines).toContain('GET malformed 400');
    expect(lines.join('\n')).not.toContain('%zz');
  });

  it('returns a bare 400 with security headers and never echoes the path', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: '/%zz', headers: { host: HOST } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad request' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).not.toContain('%zz');
  });

  it('answers a foreign host on a malformed url with 403', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: '/%zz', headers: { host: 'evil.example:4477' } });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('%zz');
  });
});

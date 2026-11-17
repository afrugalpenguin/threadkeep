import { describe, expect, it } from 'vitest';
import { UsageError } from 'threadkeep-core';
import { startServer } from '../src/index.js';
import { makeMachine } from '../../core/test/helpers.js';

describe('startServer', () => {
  it('listens on loopback, answers with its own host header, and closes', async () => {
    const { ctx } = makeMachine();
    const lines: string[] = [];
    const server = await startServer(ctx, { port: 0, log: (l) => lines.push(l) });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const token = /^http:\/\/127\.0\.0\.1:\d+\/#token=([0-9a-f]{48})$/.exec(server.openUrl)?.[1] as string;
      expect(token).toBeTruthy();
      expect(server.openUrl.startsWith(server.url)).toBe(true);
      expect((await fetch(`${server.url}api/sessions`)).status).toBe(401);
      const res = await fetch(`${server.url}api/sessions`, { headers: { 'x-threadkeep-token': token } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
      const page = await (await fetch(server.url)).text();
      expect(page).not.toContain(token);
      expect(lines.join('|')).not.toContain(token);
      expect(lines).toContain('warning: client bundle missing, run pnpm build');
    } finally {
      await server.close();
    }
  });

  it('uses a custom token and rejects an invalid one without echoing it', async () => {
    const { ctx } = makeMachine();
    const custom = 'b'.repeat(40);
    const server = await startServer(ctx, { port: 0, token: custom, log: () => {} });
    try {
      expect(server.openUrl).toBe(`${server.url}#token=${custom}`);
      expect((await fetch(`${server.url}api/sessions`, { headers: { 'x-threadkeep-token': custom } })).status).toBe(200);
    } finally {
      await server.close();
    }
    const bad = 'NOT-hex-secret-value-0123456789abcdef0123';
    const error = await startServer(ctx, { port: 0, token: bad, log: () => {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).not.toContain(bad);
    await expect(startServer(ctx, { port: 0, token: 'ab', log: () => {} })).rejects.toThrow(/token/);
  });

  it('rejects with EADDRINUSE and releases its db handle when the port is taken', async () => {
    const { ctx } = makeMachine();
    const first = await startServer(ctx, { port: 0, log: () => {} });
    try {
      await expect(startServer(ctx, { port: first.port, log: () => {} })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await first.close();
    }
  });
});

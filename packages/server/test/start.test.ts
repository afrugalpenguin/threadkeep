import { describe, expect, it } from 'vitest';
import { startServer } from '../src/index.js';
import { makeMachine } from '../../core/test/helpers.js';

describe('startServer', () => {
  it('listens on loopback, answers with its own host header, and closes', async () => {
    const { ctx } = makeMachine();
    const lines: string[] = [];
    const server = await startServer(ctx, { port: 0, log: (l) => lines.push(l) });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const res = await fetch(`${server.url}api/sessions`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
      const page = await (await fetch(server.url)).text();
      expect(page).toMatch(/name="hansard-token" content="[0-9a-f]{48}"/);
      expect(lines).toContain('warning: client bundle missing, run pnpm build');
    } finally {
      await server.close();
    }
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

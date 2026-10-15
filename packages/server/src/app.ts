import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { AddressInfo } from 'node:net';
import { openDb, type HansardContext } from '@hansard/core';

export interface AppOptions {
  token: string;
  port: number;
  publicDir: string;
  log: (line: string) => void;
}

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const STATIC: Record<string, string> = {
  '/app.js': 'text/javascript; charset=utf-8',
  '/app.css': 'text/css; charset=utf-8',
};

export const indexHtml = (token: string): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="hansard-token" content="${token}">
<title>Hansard</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`;

export const routeOf = (request: FastifyRequest): string => request.routeOptions.url ?? 'unmatched';

export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(ctx: HansardContext, options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = openDb(ctx.dbPath);
  app.decorate('db', db);
  app.addHook('onClose', async () => db.close());

  const boundPort = () => (app.server.address() as AddressInfo | null)?.port ?? options.port;
  app.addHook('onRequest', async (request, reply) => {
    const port = boundPort();
    const host = request.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return reply.code(403).send({ error: 'forbidden host' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD' && !tokenMatches(options.token, request.headers['x-hansard-token'])) {
      return reply.code(403).send({ error: 'missing or invalid token' });
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
    return payload;
  });
  // Method, route template and status only: never the query string, which can hold search text.
  app.addHook('onResponse', async (request, reply) => {
    options.log(`${request.method} ${routeOf(request)} ${reply.statusCode}`);
  });

  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(indexHtml(options.token)));
  for (const [url, type] of Object.entries(STATIC)) {
    app.get(url, async (_request, reply) => {
      const file = path.join(options.publicDir, url.slice(1));
      if (!fs.existsSync(file)) return reply.code(404).send({ error: 'not found' });
      return reply.type(type).send(fs.readFileSync(file));
    });
  }
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: import('@hansard/core').Db;
  }
}

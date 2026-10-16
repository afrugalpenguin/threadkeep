import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AddressInfo } from 'node:net';
import { AmbiguousError, NotFoundError, UsageError, openDb, safeMessage, type HansardContext } from '@hansard/core';
import { registerRoutes } from './routes.js';

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
  "img-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// The only routes served without the token: the page shell and its assets, which hold no data.
const OPEN_ROUTES = new Set(['/', '/app.js', '/app.css']);

const STATIC: Record<string, string> = {
  '/app.js': 'text/javascript; charset=utf-8',
  '/app.css': 'text/css; charset=utf-8',
};

export const indexHtml = (): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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

function securityHeaders(reply: FastifyReply): void {
  reply.header('content-security-policy', CSP);
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('cache-control', 'no-store');
}

export function createApp(ctx: HansardContext, options: AppOptions): FastifyInstance {
  // Only a plain hex string is acceptable as a token.
  if (!/^[0-9a-f]{32,}$/.test(options.token)) throw new Error('invalid token: expected at least 32 lowercase hex characters');
  const hostAllowed = (host: string | undefined): boolean => {
    const port = (app.server.address() as AddressInfo | null)?.port ?? options.port;
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  };
  const app: FastifyInstance = Fastify({
    logger: false,
    // Reject unknown body fields instead of silently stripping them (Fastify's AJV default).
    // coerceTypes true (not Fastify's 'array') so a body like {"status":["x"]} is rejected, not unwrapped.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true } },
    // Malformed URLs (for example /%zz) never reach the hooks, so answer them here without echoing the path.
    frameworkErrors: (_error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      securityHeaders(reply);
      const forbidden = !hostAllowed(request.headers.host);
      const status = forbidden ? 403 : 400;
      options.log(`${request.method} malformed ${status}`);
      return reply.code(status).send({ error: forbidden ? 'forbidden host' : 'bad request' });
    },
  });
  app.removeContentTypeParser('text/plain');
  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: 'not found' }));
  const db = openDb(ctx.dbPath);
  app.decorate('db', db);
  app.addHook('onClose', async () => db.close());

  app.addHook('onRequest', async (request, reply) => {
    if (!hostAllowed(request.headers.host)) {
      return reply.code(403).send({ error: 'forbidden host' });
    }
    const readOnly = request.method === 'GET' || request.method === 'HEAD';
    // Fail closed: only the page shell and static assets are open. Everything else (every /api route,
    // unknown paths, any other method) needs the token. Matching the raw path means an encoded or
    // oddly cased variant of an open route is simply treated as needing the token.
    const open = readOnly && OPEN_ROUTES.has(request.url.split('?')[0] ?? '');
    if (!open && !tokenMatches(options.token, request.headers['x-hansard-token'])) {
      return reply.code(readOnly || request.url.startsWith('/api/') ? 401 : 403).send({ error: 'missing or invalid token' });
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    securityHeaders(reply);
    return payload;
  });
  // Method, route template and status only: never the query string, which can hold search text.
  app.addHook('onResponse', async (request, reply) => {
    options.log(`${request.method} ${routeOf(request)} ${reply.statusCode}`);
  });

  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(indexHtml()));
  for (const [url, type] of Object.entries(STATIC)) {
    app.get(url, async (_request, reply) => {
      const file = path.join(options.publicDir, url.slice(1));
      if (!fs.existsSync(file)) return reply.code(404).send({ error: 'not found' });
      return reply.type(type).send(fs.readFileSync(file));
    });
  }
  registerRoutes(app, ctx);
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    if (error instanceof UsageError) return reply.code(400).send({ error: error.message });
    if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message });
    if (error instanceof AmbiguousError) return reply.code(409).send({ error: error.message });
    if (error.validation) return reply.code(400).send({ error: 'invalid request' });
    if (error.statusCode !== undefined && error.statusCode < 500) return reply.code(error.statusCode).send({ error: 'bad request' });
    options.log(`error ${request.method} ${routeOf(request)}: ${safeMessage(ctx, error)}`);
    return reply.code(500).send({ error: 'internal error' });
  });
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: import('@hansard/core').Db;
  }
}

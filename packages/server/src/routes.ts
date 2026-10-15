import type { FastifyInstance } from 'fastify';
import {
  getSession,
  listDecisions,
  listFacets,
  listSessions,
  search,
  setDecisionStatus,
  type HansardContext,
  type ListSessionsOptions,
  type SearchOptions,
} from '@hansard/core';
import { MARK_CLOSE, MARK_OPEN } from './shared/marks.js';

type Query = Record<string, string | number | boolean | undefined>;

// Copies only defined values so exactOptionalPropertyTypes stays satisfied.
function defined<T extends object>(source: Query, keys: readonly string[]): Partial<T> {
  const out: Query = {};
  for (const key of keys) if (source[key] !== undefined && source[key] !== '') out[key] = source[key];
  return out as Partial<T>;
}

const text = { type: 'string', maxLength: 500 } as const;
const filters = { source: text, project: text, since: text, machine: text } as const;

export function registerRoutes(app: FastifyInstance, ctx: HansardContext): void {
  app.get(
    '/api/sessions',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            ...filters,
            sort: { type: 'string', enum: ['time', 'project', 'source', 'length'] },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
            offset: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as Query;
      return listSessions(app.db, defined<ListSessionsOptions>(q, ['source', 'project', 'since', 'machine', 'sort', 'limit', 'offset']));
    },
  );

  app.get(
    '/api/search',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            ...filters,
            q: text,
            role: { type: 'string', enum: ['user', 'assistant', 'tool'] },
            sort: { type: 'string', enum: ['rank', 'time'] },
            thinking: { type: 'boolean' },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
          },
        },
      },
    },
    async (request) => {
      const q = request.query as Query;
      const options: SearchOptions = {
        query: String(q['q']),
        marks: [MARK_OPEN, MARK_CLOSE],
        limit: typeof q['limit'] === 'number' ? q['limit'] : 100,
        ...defined<SearchOptions>(q, ['source', 'project', 'since', 'machine', 'role', 'sort', 'thinking']),
      };
      return search(app.db, options);
    },
  );

  app.get(
    '/api/sessions/:id',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', maxLength: 100 } } },
        querystring: { type: 'object', properties: { thinking: { type: 'boolean' }, expandTools: { type: 'boolean' } } },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const q = request.query as Query;
      return getSession(app.db, id, { thinking: q['thinking'] === true, expandTools: q['expandTools'] === true });
    },
  );

  app.get('/api/facets', async () => listFacets(ctx, app.db));

  app.get(
    '/api/decisions',
    { schema: { querystring: { type: 'object', properties: { status: text, session: text } } } },
    async (request) => listDecisions(app.db, defined(request.query as Query, ['status', 'session'])),
  );

  app.post(
    '/api/decisions/:id/status',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', maxLength: 100 } } },
        body: {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: { status: { type: 'string', enum: ['confirmed', 'dismissed'] } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { status } = request.body as { status: 'confirmed' | 'dismissed' };
      return setDecisionStatus(app.db, id, status);
    },
  );
}

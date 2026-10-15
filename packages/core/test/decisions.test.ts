import { describe, expect, it } from 'vitest';
import {
  NotFoundError,
  UsageError,
  applyExclusions,
  ingestAll,
  listDecisions,
  openDb,
  setDecisionStatus,
  type Db,
} from '../src/index.js';
import { userText } from '../src/adapters/claude-code/fixtures.js';
import { makeMachine, writeSession } from './helpers.js';

const S1 = 'dddddddd-1111-4111-8111-111111111111';
const S2 = 'dddddddd-2222-4222-8222-222222222222';
const at = (sid: string, n: number) => ({ sessionId: sid, uuid: `${sid.slice(0, 2)}${n}`, timestamp: `2026-03-0${n}T10:00:00.000Z` });

async function seeded() {
  const m = makeMachine();
  writeSession(m.claudeRoot, S1, userText(at(S1, 1), 'first session'));
  writeSession(m.claudeRoot, S2, userText(at(S2, 2), 'second session'), '-home-alice-projects-other');
  await ingestAll(m.ctx);
  const db = openDb(m.ctx.dbPath);
  const insert = db.prepare(
    'insert into decisions (id, session_id, event_id, statement, rationale, alternatives, status, machine_id, created_at) values (?, ?, null, ?, ?, null, ?, ?, ?)',
  );
  insert.run('d1', S1, 'use sqlite', 'local first', 'proposed', m.ctx.machineId, '2026-03-01T10:00:00.000Z');
  insert.run('d2', S1, 'use fastify', null, 'confirmed', m.ctx.machineId, '2026-03-02T10:00:00.000Z');
  insert.run('d3', S2, 'hidden one', null, 'proposed', m.ctx.machineId, '2026-03-03T10:00:00.000Z');
  return { m, db };
}

const exclude = (db: Db, id: string) => applyExclusions(db, { projectGlobs: [], sessionIds: [id] });

describe('listDecisions', () => {
  it('lists newest first with the session title and filters by status and session', async () => {
    const { db } = await seeded();
    try {
      expect(listDecisions(db).map((d) => d.id)).toEqual(['d3', 'd2', 'd1']);
      expect(listDecisions(db, { status: 'proposed' }).map((d) => d.id)).toEqual(['d3', 'd1']);
      expect(listDecisions(db, { session: S1 }).map((d) => d.id)).toEqual(['d2', 'd1']);
      expect(listDecisions(db)[2]).toMatchObject({ id: 'd1', statement: 'use sqlite', rationale: 'local first', status: 'proposed', session_id: S1 });
      expect(() => listDecisions(db, { status: 'bogus' })).toThrow(UsageError);
    } finally {
      db.close();
    }
  });

  it('never returns decisions from excluded sessions', async () => {
    const { db } = await seeded();
    try {
      exclude(db, S2);
      expect(listDecisions(db).map((d) => d.id)).toEqual(['d2', 'd1']);
      expect(listDecisions(db, { session: S2 })).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('setDecisionStatus', () => {
  it('moves proposed to confirmed or dismissed and returns the row', async () => {
    const { db } = await seeded();
    try {
      expect(setDecisionStatus(db, 'd1', 'dismissed')).toMatchObject({ id: 'd1', status: 'dismissed' });
      expect(listDecisions(db, { status: 'dismissed' }).map((d) => d.id)).toEqual(['d1']);
    } finally {
      db.close();
    }
  });

  it('rejects other transitions, unknown ids, excluded sessions and bad statuses', async () => {
    const { db } = await seeded();
    try {
      expect(() => setDecisionStatus(db, 'd2', 'dismissed')).toThrow(UsageError);
      expect(() => setDecisionStatus(db, 'nope', 'confirmed')).toThrow(NotFoundError);
      exclude(db, S2);
      expect(() => setDecisionStatus(db, 'd3', 'confirmed')).toThrow(NotFoundError);
      expect(() => setDecisionStatus(db, 'd1', 'proposed' as 'confirmed')).toThrow(UsageError);
      expect(listDecisions(db, { status: 'confirmed' }).map((d) => d.id)).toEqual(['d2']);
    } finally {
      db.close();
    }
  });
});

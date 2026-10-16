import type { Db } from './store/db.js';
import { NotFoundError, UsageError, pagingValue } from './query.js';

export const DECISION_STATUSES = ['proposed', 'confirmed', 'dismissed'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export interface DecisionRow {
  id: string;
  session_id: string;
  event_id: string | null;
  statement: string;
  rationale: string | null;
  alternatives: string | null;
  status: DecisionStatus;
  machine_id: string | null;
  created_at: string | null;
  session_title: string | null;
}

export interface ListDecisionsOptions {
  status?: string;
  session?: string;
  limit?: number;
}

const columns = `d.id, d.session_id, d.event_id, d.statement, d.rationale, d.alternatives, d.status, d.machine_id, d.created_at,
  s.title as session_title`;

// Decisions are only visible through a non-excluded session.
export function listDecisions(db: Db, options: ListDecisionsOptions = {}): DecisionRow[] {
  const where = ['s.excluded = 0'];
  const params: (string | number)[] = [];
  if (options.status !== undefined) {
    if (!(DECISION_STATUSES as readonly string[]).includes(options.status)) {
      throw new UsageError(`invalid status: use ${DECISION_STATUSES.join(', ')}`);
    }
    where.push('d.status = ?');
    params.push(options.status);
  }
  if (options.session !== undefined) {
    where.push('d.session_id = ?');
    params.push(options.session);
  }
  params.push(pagingValue(options.limit, 'limit', 200));
  return db
    .prepare(
      `select ${columns} from decisions d join sessions s on s.id = d.session_id
       where ${where.join(' and ')} order by d.created_at desc, d.id limit ?`,
    )
    .all(...params) as DecisionRow[];
}

export function setDecisionStatus(db: Db, id: string, status: 'confirmed' | 'dismissed'): DecisionRow {
  if (status !== 'confirmed' && status !== 'dismissed') throw new UsageError('status must be confirmed or dismissed');
  return db.transaction(() => {
    const found = db
      .prepare('select d.status from decisions d join sessions s on s.id = d.session_id where d.id = ? and s.excluded = 0')
      .get(id) as { status: DecisionStatus } | undefined;
    if (!found) throw new NotFoundError('decision not found');
    if (found.status !== 'proposed') throw new UsageError(`decision is already ${found.status}`);
    const updated = db.prepare("update decisions set status = ? where id = ? and status = 'proposed'").run(status, id);
    if (updated.changes !== 1) throw new UsageError('decision status changed, reload and try again');
    return db
      .prepare(`select ${columns} from decisions d join sessions s on s.id = d.session_id where d.id = ?`)
      .get(id) as DecisionRow;
  }).immediate();
}

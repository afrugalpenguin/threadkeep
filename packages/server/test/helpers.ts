import { ingestAll, openDb } from '@hansard/core';
import { assistant, toolResultLine, userText } from '../../core/src/adapters/claude-code/fixtures.js';
import { makeMachine, writeSession, type Machine } from '../../core/test/helpers.js';
import { createApp, type AppOptions } from '../src/app.js';

export const S1 = 'eeeeeeee-1111-4111-8111-111111111111';
export const S2 = 'eeeeeeee-2222-4222-8222-222222222222';
export const TOKEN = 'a'.repeat(48);
export const PORT = 4477;
export const HOST = `127.0.0.1:${PORT}`;
export const AUTH = { host: HOST, 'x-hansard-token': TOKEN };

// Assembled at runtime so no scanner sees a literal token in this file.
export const SECRET = ['AKIA', 'A1'.repeat(8)].join('');

const at = (sid: string, n: number, cwd?: string) => ({
  sessionId: sid,
  uuid: `${sid.slice(0, 2)}${n}`,
  timestamp: `2026-04-0${n}T10:00:00.000Z`,
  ...(cwd ? { cwd } : {}),
});
const SECRET_PROJECT = '/home/alice/projects/secret';

export async function seededApp(extra: Partial<AppOptions> = {}) {
  const m: Machine = makeMachine();
  writeSession(
    m.claudeRoot,
    S1,
    userText(at(S1, 1), `visible question with key ${SECRET} inside`) +
      assistant(at(S1, 2), [
        { type: 'text', text: 'visible answer [with brackets]' },
        { type: 'thinking', thinking: `considering ${SECRET}` },
        { type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/home/alice/projects/demo/a.ts', new_string: `k=${SECRET}` } },
      ]) +
      toolResultLine(at(S1, 3), 'tu1', `edited with key ${SECRET}`),
  );
  writeSession(m.claudeRoot, S2, userText(at(S2, 4, SECRET_PROJECT), 'hidden question excluded'), '-home-alice-projects-secret');
  await ingestAll(m.ctx);
  const db = openDb(m.ctx.dbPath);
  db.prepare(
    "insert into decisions (id, session_id, statement, status, created_at) values ('d1', ?, 'use sqlite', 'proposed', '2026-04-01T10:00:00.000Z'), ('d2', ?, 'hidden decision', 'proposed', '2026-04-02T10:00:00.000Z')",
  ).run(S1, S2);
  db.close();
  const lines: string[] = [];
  const app = createApp(m.ctx, { token: TOKEN, port: PORT, log: (l) => lines.push(l), publicDir: m.userHome, ...extra });
  await app.ready();
  return { m, app, lines };
}

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FixtureGenerator } from '../types.js';

export const FIXTURE_PROJECT = '/home/alice/projects/demo';
export const FIXTURE_PROJECT_WINDOWS = 'C:\\Users\\alice\\projects\\demo';

export function projectFolderName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export interface LineBase {
  sessionId: string;
  uuid: string;
  timestamp: string;
  cwd?: string;
}

const base = (b: LineBase) => ({
  parentUuid: null,
  isSidechain: false,
  uuid: b.uuid,
  timestamp: b.timestamp,
  sessionId: b.sessionId,
  cwd: b.cwd ?? FIXTURE_PROJECT,
  gitBranch: 'main',
  version: '0.0.0-fixture',
});

export const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

export const userText = (b: LineBase, content: string | unknown[]) =>
  line({ ...base(b), type: 'user', message: { role: 'user', content } });

// A user line that Claude Code generated itself: pass { isMeta: true } or { isCompactSummary: true }.
export const flaggedUserText = (b: LineBase, content: string | unknown[], flags: Record<string, unknown>) =>
  line({ ...base(b), type: 'user', message: { role: 'user', content }, ...flags });

export const assistant = (b: LineBase, content: unknown[]) =>
  line({ ...base(b), type: 'assistant', message: { role: 'assistant', content } });

export const toolResultLine = (b: LineBase, toolUseId: string, content: unknown, extra: Record<string, unknown> = {}) =>
  line({
    ...base(b),
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: false, content }] },
    ...extra,
  });

export const aiTitle = (sessionId: string, title: string) => line({ type: 'ai-title', sessionId, aiTitle: title });

// Writes <root>/<project folder>/<uuid>.jsonl with small synthetic conversations.
export const claudeCodeFixtures: FixtureGenerator = {
  generate({ root, sessions = 2 }) {
    const ids: string[] = [];
    const folder = path.join(root, projectFolderName(FIXTURE_PROJECT));
    fs.mkdirSync(folder, { recursive: true });
    for (let n = 1; n <= sessions; n += 1) {
      const sessionId = randomUUID();
      ids.push(sessionId);
      const at = (s: number) => `2026-01-0${n}T10:00:0${s}.000Z`;
      const toolId = `toolu_demo_${n}`;
      const text =
        userText({ sessionId, uuid: `u${n}-1`, timestamp: at(0) }, `Demo conversation ${n} question`) +
        assistant({ sessionId, uuid: `a${n}-1`, timestamp: at(1) }, [
          { type: 'text', text: `Demo conversation ${n} answer` },
          { type: 'tool_use', id: toolId, name: 'Read', input: { file_path: `${FIXTURE_PROJECT}/readme.md` } },
        ]) +
        toolResultLine({ sessionId, uuid: `u${n}-2`, timestamp: at(2) }, toolId, 'demo file body') +
        aiTitle(sessionId, `Demo conversation ${n}`);
      fs.writeFileSync(path.join(folder, `${sessionId}.jsonl`), text);
    }
    return { sessionIds: ids };
  },
};

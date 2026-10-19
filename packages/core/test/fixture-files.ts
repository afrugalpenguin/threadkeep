import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Hand-written synthetic sessions laid out like ~/.claude/projects. See tests/fixtures/claude-code.
export const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tests', 'fixtures', 'claude-code');

export const DEMO_FOLDER = '-home-alice-projects-demo';
export const NOTES_FOLDER = 'C--Users-alice-projects-notes';

export const FIXTURE_SESSIONS = {
  vacuum: { id: 'aaaaaaaa-0000-4000-8000-000000000001', folder: DEMO_FOLDER },
  kestrel: { id: 'aaaaaaaa-0000-4000-8000-000000000002', folder: DEMO_FOLDER },
  notes: { id: 'aaaaaaaa-0000-4000-8000-000000000003', folder: NOTES_FOLDER },
} as const;

export function fixturePath(session: { id: string; folder: string }): string {
  return path.join(FIXTURE_ROOT, session.folder, `${session.id}.jsonl`);
}

// Copies the fixture tree into a fake ~/.claude/projects.
export function copyFixtures(claudeRoot: string): void {
  fs.cpSync(FIXTURE_ROOT, claudeRoot, { recursive: true });
}

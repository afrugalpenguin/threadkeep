import fs from 'node:fs';
import path from 'node:path';
import StreamArray from 'stream-json/streamers/StreamArray.js';
import type { HansardContext } from '../../config.js';
import { toPosix } from '../../paths.js';
import type { ArchiveFile, ParseResult, SourceAdapter } from '../types.js';
import { claudeAiFixtures } from './fixtures.js';
import { parseConversation } from './parse.js';
import { CONVERSATIONS_ENTRY, openZipEntry } from './zip.js';

const ID = 'claude-ai';

export function archiveDir(ctx: HansardContext): string {
  return path.join(ctx.archiveRoot, 'raw', ID);
}

export interface Sidecar {
  sha256: string;
  machine_id: string;
  original_name: string;
  imported_at: string;
}

export function readSidecar(zipPath: string): Sidecar | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(zipPath.replace(/\.zip$/i, '.json'), 'utf8')) as Partial<Sidecar>;
    return typeof parsed.machine_id === 'string' && parsed.machine_id.length > 0 ? (parsed as Sidecar) : null;
  } catch {
    return null;
  }
}

function archiveFiles(ctx: HansardContext, onWarning?: (message: string) => void): ArchiveFile[] {
  const dir = archiveDir(ctx);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => /^[0-9a-f]{64}\.zip$/.test(n));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onWarning?.(`raw/${ID}: unreadable directory, skipped`);
    return [];
  }
  return names.sort().map((name) => {
    const absPath = path.join(dir, name);
    return {
      // An empty machine id marks a zip whose sidecar has not synced yet; ingest skips it until it does.
      machineId: readSidecar(absPath)?.machine_id ?? '',
      relPath: toPosix(path.relative(ctx.archiveRoot, absPath)),
      absPath,
    };
  });
}

async function* parseArchive(file: ArchiveFile): AsyncGenerator<ParseResult> {
  const entry = await openZipEntry(file.absPath, CONVERSATIONS_ENTRY);
  const array = StreamArray.withParser();
  entry.on('error', (error) => array.destroy(error));
  entry.pipe(array);
  try {
    for await (const item of array) {
      const { key, value } = item as { key: number; value: unknown };
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      yield parseConversation(value as Record<string, unknown>, key);
    }
  } finally {
    entry.destroy();
  }
}

export const claudeAiAdapter: SourceAdapter = {
  id: ID,
  displayName: 'claude.ai export',
  kind: 'import',
  describe: () => ({
    reads: 'claude.ai data export zips (conversations.json)',
    localLocation: 'none, imported with: hansard import claude-ai <path>',
    archiveLayout: 'raw/claude-ai/<sha256>.zip with a <sha256>.json sidecar',
  }),
  discover(ctx) {
    const count = archiveFiles(ctx).length;
    return [{ location: archiveDir(ctx), found: count > 0, detail: `${count} imported exports` }];
  },
  archiveFiles,
  skipReason: (file) => (file.machineId === '' ? 'sidecar missing, skipped until it syncs' : null),
  parse: () => ({ records: [], events: [], patches: [], sessions: [], warnings: [] }),
  parseArchive: (file) => parseArchive(file),
  fixtures: claudeAiFixtures,
};

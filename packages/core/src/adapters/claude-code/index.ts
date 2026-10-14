import fs from 'node:fs';
import path from 'node:path';
import type { HansardContext } from '../../config.js';
import { relativeWithin, toPosix } from '../../paths.js';
import type { ArchiveFile, MirrorReport, SourceAdapter } from '../types.js';
import { claudeCodeFixtures } from './fixtures.js';
import { SESSION_FILE, archivePathFor, listLocalSessions, mirrorOne } from './mirror.js';
import { parseClaudeCode } from './parse.js';

const ID = 'claude-code';

function root(ctx: HansardContext): string | null {
  return ctx.sources[ID]?.root ?? null;
}

function subdirs(dir: string, onFail?: () => void): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onFail?.();
    return [];
  }
}

function archiveFiles(ctx: HansardContext, onWarning?: (message: string) => void): ArchiveFile[] {
  const base = path.join(ctx.archiveRoot, 'raw', ID);
  const out: ArchiveFile[] = [];
  const warn = (rel: string) => () => onWarning?.(`${rel}: unreadable directory, skipped`);
  for (const machineId of subdirs(base, warn(`raw/${ID}`))) {
    for (const project of subdirs(path.join(base, machineId), warn(`raw/${ID}/${machineId}`))) {
      const dir = path.join(base, machineId, project);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        warn(`raw/${ID}/${machineId}/${project}`)();
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jsonl')) continue;
        const absPath = path.join(dir, entry.name);
        out.push({ machineId, relPath: toPosix(path.relative(ctx.archiveRoot, absPath)), absPath });
      }
    }
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function archiveFileFor(ctx: HansardContext, localPath: string): ArchiveFile | null {
  const r = root(ctx);
  if (!r) return null;
  const rel = relativeWithin(r, localPath);
  const parts = rel?.split('/') ?? [];
  if (parts.length !== 2 || !SESSION_FILE.test(parts[1] as string)) return null;
  const { abs, rel: archiveRel } = archivePathFor(ctx, ID, {
    projectFolder: parts[0] as string,
    fileName: parts[1] as string,
    localPath,
  });
  return { machineId: ctx.machineId, relPath: archiveRel, absPath: abs };
}

export const claudeCodeAdapter: SourceAdapter = {
  id: ID,
  displayName: 'Claude Code',
  kind: 'live',
  describe: () => ({
    reads: 'session transcripts (<project>/<session>.jsonl)',
    localLocation: '~/.claude/projects',
    archiveLayout: 'raw/claude-code/<machine_id>/<project>/<session>.jsonl',
  }),
  discover(ctx) {
    const r = root(ctx);
    if (!r) return [];
    const found = fs.existsSync(r);
    return [{ location: r, found, detail: `${found ? listLocalSessions(r).length : 0} session files` }];
  },
  mirror(ctx, opts): MirrorReport {
    const report: MirrorReport = { filesMirrored: 0, bytesAppended: 0, skipped: [] };
    const r = root(ctx);
    if (!r) return report;
    if (opts?.file) {
      if (!archiveFileFor(ctx, opts.file)) throw new Error('path is not a session file under a configured source');
      const parts = (relativeWithin(r, opts.file) as string).split('/') as [string, string];
      mirrorOne(ctx, ID, { projectFolder: parts[0], fileName: parts[1], localPath: opts.file }, report);
      return report;
    }
    const onSkip = (folder: string) => report.skipped.push({ relPath: folder, reason: 'unreadable directory, skipped' });
    for (const session of listLocalSessions(r, onSkip)) mirrorOne(ctx, ID, session, report);
    return report;
  },
  archiveFileFor,
  archiveFiles,
  skipReason: (file) =>
    SESSION_FILE.test(file.relPath.split('/').pop() ?? '') ? null : 'not a session file name, skipped',
  parse: (file, chunk) => parseClaudeCode(file, chunk),
  fixtures: claudeCodeFixtures,
};

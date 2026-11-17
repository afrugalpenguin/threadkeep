import fs from 'node:fs';
import path from 'node:path';
import type { ThreadkeepContext } from '../../config.js';
import { PRIVATE_FILE_MODE, mkdirPrivate, toPosix } from '../../paths.js';
import type { MirrorReport } from '../types.js';

export const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const TAIL = 4096;

export interface LocalSession {
  projectFolder: string;
  fileName: string;
  localPath: string;
}

export function archivePathFor(ctx: ThreadkeepContext, adapterId: string, s: LocalSession): { abs: string; rel: string } {
  const rel = toPosix(path.join('raw', adapterId, ctx.machineId, s.projectFolder, s.fileName));
  return { abs: path.join(ctx.archiveRoot, rel), rel };
}

// Only top-level <project>/<uuid>.jsonl files are sessions; subagents, tool-results and memory are ignored.
export function listLocalSessions(root: string, onSkip?: (projectFolder: string) => void): LocalSession[] {
  const out: LocalSession[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = path.join(root, project.name);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      onSkip?.(project.name);
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && SESSION_FILE.test(entry.name)) {
        out.push({ projectFolder: project.name, fileName: entry.name, localPath: path.join(dir, entry.name) });
      }
    }
  }
  return out.sort((a, b) => a.localPath.localeCompare(b.localPath));
}

function readRange(fd: number, start: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, buffer, read, length - read, start + read);
    if (n === 0) break;
    read += n;
  }
  return buffer.subarray(0, read);
}

// Append-only byte mirror. The archive file is the only state: it is never rewritten, truncated or deleted,
// and the source is only ever opened read-only.
export function mirrorOne(ctx: ThreadkeepContext, adapterId: string, session: LocalSession, report: MirrorReport): void {
  const { abs, rel } = archivePathFor(ctx, adapterId, session);
  report.filesScanned += 1;
  const skip =(reason: string): void => {
    report.skipped.push({ relPath: rel, reason });
  };
  let fd: number;
  try {
    fd = fs.openSync(session.localPath, 'r');
  } catch {
    skip('source unreadable, skipped');
    return;
  }
  try {
    const localSize = fs.fstatSync(fd).size;
    let archived = 0;
    try {
      archived = fs.statSync(abs).size;
    } catch {
      archived = 0;
    }
    if (localSize < archived) return skip('local file shorter than archive, skipped');
    if (archived > 0) {
      const n = Math.min(TAIL, archived);
      const archiveFd = fs.openSync(abs, 'r');
      try {
        const a = readRange(archiveFd, archived - n, n);
        const l = readRange(fd, archived - n, n);
        if (a.length !== n || !a.equals(l)) return skip('diverged, skipped');
      } finally {
        fs.closeSync(archiveFd);
      }
    }
    if (localSize === archived) return;
    const tail = readRange(fd, archived, localSize - archived);
    const lastNewline = tail.lastIndexOf(0x0a);
    if (lastNewline < 0) return; // never copy a partial trailing line
    const data = tail.subarray(0, lastNewline + 1);
    mkdirPrivate(path.dirname(abs));
    const out = fs.openSync(abs, 'a', PRIVATE_FILE_MODE);
    try {
      fs.writeSync(out, data);
      fs.fsyncSync(out);
    } finally {
      fs.closeSync(out);
    }
    report.filesMirrored += 1;
    report.bytesAppended += data.length;
  } finally {
    fs.closeSync(fd);
  }
}

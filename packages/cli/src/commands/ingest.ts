import path from 'node:path';
import { ingestAll, ingestFile, type FileStatus, type IngestResult } from 'threadkeep-core';
import { intFlag, parse, str } from '../args.js';
import { usage, type Command } from '../types.js';

// Files with new content are always listed; --verbose lists every file. Skip and failure reasons are warnings.
export function printIngest(result: IngestResult, write: (s: string) => void, errors: (s: string) => void, verbose = false): void {
  for (const f of result.files) {
    if (f.status === 'ingested') write(`ingested  ${f.relPath}  +${f.newEvents} events  +${f.newRaw} records\n`);
    else if (verbose) write(`${f.status}  ${f.relPath}\n`);
  }
  const count = (status: FileStatus) => result.files.filter((f) => f.status === status).length;
  write(`mirrored ${result.mirroredFiles} files, ${result.mirroredBytes} bytes\n`);
  write(`ingested ${result.filesIngested} files, ${result.newEvents} new events, ${result.newRaw} new records\n`);
  write(
    `scanned ${result.sourceFilesScanned} source files, ${result.files.length} archive files: ` +
      `${count('ingested')} ingested, ${count('unchanged')} unchanged, ${count('skipped')} skipped, ${count('failed')} failed\n`,
  );
  for (const warning of result.warnings) errors(`warning: ${warning}\n`);
}

export const ingestCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, { wait: { type: 'string' }, verbose: { type: 'boolean' } });
  if (positionals.length > 1) throw usage('ingest takes at most one path');
  const ctx = env.context(str(values['home']));
  const waitMs = intFlag(values['wait'], 'wait', 30_000);
  const onProgress = (done: number, total: number) => {
    if (done === total || done % 25 === 0) env.io.stdout.write(`progress ${done}/${total} files\n`);
  };
  const target = positionals[0];
  const result = target
    ? await ingestFile(ctx, path.resolve(target), { waitMs, onProgress })
    : await ingestAll(ctx, { waitMs, onProgress });
  printIngest(
    result,
    (s) => env.io.stdout.write(s),
    (s) => env.io.stderr.write(s),
    values['verbose'] === true,
  );
  if (result.failedFiles > 0) {
    env.io.stderr.write(`error: ${result.failedFiles} archive file(s) failed to ingest\n`);
    return 1;
  }
  return 0;
};

import path from 'node:path';
import { ingestAll, ingestFile, type IngestResult } from '@hansard/core';
import { intFlag, parse, str } from '../args.js';
import { usage, type Command } from '../types.js';

export function printIngest(result: IngestResult, write: (s: string) => void, errors: (s: string) => void): void {
  write(`mirrored ${result.mirroredFiles} files, ${result.mirroredBytes} bytes\n`);
  write(`ingested ${result.filesIngested} files, ${result.newEvents} new events, ${result.newRaw} new records\n`);
  for (const warning of result.warnings) errors(`warning: ${warning}\n`);
}

export const ingestCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, { wait: { type: 'string' } });
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
  );
  if (result.failedFiles > 0) {
    env.io.stderr.write(`error: ${result.failedFiles} archive file(s) failed to ingest\n`);
    return 1;
  }
  return 0;
};

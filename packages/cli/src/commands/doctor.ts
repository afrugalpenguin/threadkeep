import fs from 'node:fs';
import path from 'node:path';
import { displayPath, listSources, machineSummary, openDb, schemaVersion, type HansardContext } from '@hansard/core';
import { parse, str } from '../args.js';
import { shortId } from '../format.js';
import { usage, type Command } from '../types.js';
import { UI_TOKEN_PROBLEM, readUiToken } from '../ui-token.js';

type Level = 'ok' | 'warn' | 'fail';
interface Check {
  level: Level;
  name: string;
  detail: string;
}

function writable(dir: string): boolean {
  const probe = path.join(dir, `.doctor-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

function archiveSize(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    bytes += fs.statSync(path.join(entry.parentPath, entry.name)).size;
    files += 1;
  }
  return { bytes, files };
}

function humanBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function onPath(env: Record<string, string | undefined>): boolean {
  const names = process.platform === 'win32' ? ['hansard.cmd', 'hansard.exe', 'hansard.ps1', 'hansard'] : ['hansard'];
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => names.some((n) => fs.existsSync(path.join(dir, n))));
}

export function runChecks(ctx: HansardContext, env: Record<string, string | undefined>): Check[] {
  const checks: Check[] = [];
  const add = (level: Level, name: string, detail: string) => checks.push({ level, name, detail });

  if (writable(ctx.home)) add('ok', 'data dir', displayPath(ctx, ctx.home));
  else add('fail', 'data dir', `${displayPath(ctx, ctx.home)} is not writable`);

  if (process.platform !== 'win32') {
    try {
      if ((fs.statSync(ctx.home).mode & 0o077) !== 0) {
        add('warn', 'data dir permissions', `${displayPath(ctx, ctx.home)} is readable by other accounts, run: chmod 700 ${displayPath({ userHome: ctx.userHome }, ctx.home)}`);
      }
    } catch {
      // The data dir check above already reports an unusable home.
    }
  }

  try {
    JSON.parse(fs.readFileSync(ctx.configPath, 'utf8'));
    add('ok', 'config', displayPath(ctx, ctx.configPath));
  } catch {
    add('fail', 'config', 'config.json is missing or not valid JSON');
  }

  try {
    add('ok', 'ui token', readUiToken(ctx) ? 'fixed (config)' : 'per run');
  } catch {
    add('fail', 'ui token', UI_TOKEN_PROBLEM);
  }

  try {
    const db = openDb(ctx.dbPath);
    try {
      add('ok', 'database', `${displayPath(ctx, ctx.dbPath)} schema version ${schemaVersion(db)}`);
      const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      const excluded = count('select count(*) as n from sessions where excluded = 1');
      add(
        'ok',
        'contents',
        `${count('select count(*) as n from sessions')} sessions, ${count('select count(*) as n from events')} events` +
          (excluded > 0 ? `, ${excluded} sessions excluded` : ''),
      );
      for (const m of machineSummary(ctx, db)) {
        add('ok', 'machine sessions', `${m.label ?? shortId(m.id)}: ${m.sessions}${m.current ? ' (this machine)' : ''}`);
      }
    } finally {
      db.close();
    }
  } catch (error) {
    add('fail', 'database', error instanceof Error ? error.message.split('\n')[0] ?? 'cannot open' : 'cannot open');
  }

  if (!fs.existsSync(ctx.archiveRoot)) add('warn', 'archive', `${displayPath(ctx, ctx.archiveRoot)} does not exist yet, created on first ingest`);
  else if (writable(ctx.archiveRoot)) {
    add('ok', 'archive', `${displayPath(ctx, ctx.archiveRoot)} reachable and writable`);
    try {
      const size = archiveSize(ctx.archiveRoot);
      add('ok', 'archive size', `${humanBytes(size.bytes)} (${size.bytes} bytes) in ${size.files} files`);
    } catch {
      add('warn', 'archive size', 'could not read every archive file');
    }
  } else add('fail', 'archive', `${displayPath(ctx, ctx.archiveRoot)} is not writable`);

  add('ok', 'machine', `${shortId(ctx.machineId)} label ${ctx.machineLabel ?? '(none)'}`);

  for (const source of listSources(ctx)) {
    if (source.found) add('ok', `source ${source.id}`, 'found');
    else if (source.kind === 'import') add('ok', `source ${source.id}`, 'no exports imported yet');
    else add('warn', `source ${source.id}`, 'not found on this machine');
  }

  if (writable(path.dirname(ctx.hooksLogPath))) add('ok', 'hooks log', displayPath(ctx, ctx.hooksLogPath));
  else add('fail', 'hooks log', 'not writable');

  add(onPath(env) ? 'ok' : 'warn', 'hansard on PATH', onPath(env) ? 'found' : 'not found');
  add('warn', 'mcp server', 'not built yet');
  return checks;
}

export const doctorCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, {});
  if (positionals.length > 0) throw usage('doctor takes no positional arguments');
  const ctx = env.context(str(values['home']));
  const checks = runChecks(ctx, env.env);
  for (const c of checks) env.io.stdout.write(`${c.level.padEnd(4)}  ${c.name}: ${c.detail}\n`);
  const failed = checks.filter((c) => c.level === 'fail').length;
  const warned = checks.filter((c) => c.level === 'warn').length;
  env.io.stdout.write(`${failed} failed, ${warned} warnings\n`);
  return failed > 0 ? 1 : 0;
};

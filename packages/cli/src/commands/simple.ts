import {
  changeExclusion,
  displayPath,
  listSources,
  machineSummary,
  openDb,
  readExclusions,
  rebuild,
  setMachineLabel,
} from '@hansard/core';
import { parse, str } from '../args.js';
import { jsonOut, shortId } from '../format.js';
import { usage, type Command } from '../types.js';

export const rebuildCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, { wait: { type: 'string' } });
  if (positionals.length > 0) throw usage('rebuild takes no positional arguments');
  const ctx = env.context(str(values['home']));
  const waitMs = typeof values['wait'] === 'string' ? Number(values['wait']) : 30_000;
  if (!Number.isInteger(waitMs) || waitMs < 0) throw usage('--wait must be a non-negative integer');
  const result = await rebuild(ctx, {
    waitMs,
    onProgress: (done, total) => {
      if (done === total || done % 25 === 0) env.io.stdout.write(`progress ${done}/${total} files\n`);
    },
  });
  env.io.stdout.write(`rebuilt ${result.sessions} sessions, ${result.events} events, ${result.raw} records\n`);
  for (const warning of result.warnings) env.io.stderr.write(`warning: ${warning}\n`);
  return 0;
};

export const exclusionsCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, { project: { type: 'string' }, session: { type: 'string' } });
  const [action, ...extra] = positionals;
  if (extra.length > 0) throw usage('exclusions takes one action and no positional values');
  const ctx = env.context(str(values['home']));
  const out = (s: string) => env.io.stdout.write(s);
  if (action === 'list') {
    const current = readExclusions(ctx);
    out(`project globs (${current.projectGlobs.length})\n`);
    for (const g of current.projectGlobs) out(`  ${g}\n`);
    out(`session ids (${current.sessionIds.length})\n`);
    for (const id of current.sessionIds) out(`  ${id}\n`);
    return 0;
  }
  if (action !== 'add' && action !== 'remove') throw usage('exclusions needs: list | add | remove');
  const project = str(values['project']);
  const session = str(values['session']);
  if ((project === undefined) === (session === undefined)) throw usage(`exclusions ${action} needs exactly one of --project or --session`);
  const db = openDb(ctx.dbPath);
  try {
    const change = project !== undefined ? { kind: 'project' as const, value: project } : { kind: 'session' as const, value: session as string };
    const changed = changeExclusion(ctx, db, action, change);
    out(changed ? `${action === 'add' ? 'added' : 'removed'} ${change.kind} exclusion\n` : `no change, ${change.kind} exclusion ${action === 'add' ? 'already present' : 'not present'}\n`);
    return 0;
  } finally {
    db.close();
  }
};

export const sourcesCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, { json: { type: 'boolean' } });
  if (positionals.length > 0) throw usage('sources takes no positional arguments');
  const ctx = env.context(str(values['home']));
  const sources = listSources(ctx).map((s) => ({
    ...s,
    locations: s.locations.map((l) => ({ ...l, location: displayPath(ctx, l.location) })),
  }));
  if (values['json']) {
    env.io.stdout.write(jsonOut(sources));
    return 0;
  }
  for (const s of sources) {
    const where = s.locations.map((l) => l.location).join(', ') || '-';
    env.io.stdout.write(`${s.id}  ${s.kind}  found ${s.found ? 'yes' : 'no'}  ${where}\n`);
  }
  return 0;
};

export const machineCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, {});
  const [action, ...rest] = positionals;
  const ctx = env.context(str(values['home']));
  const out = (s: string) => env.io.stdout.write(s);
  if (action === 'show' && rest.length === 0) {
    out(`id: ${ctx.machineId}\nlabel: ${ctx.machineLabel ?? '(none)'}\n`);
    const db = openDb(ctx.dbPath);
    try {
      for (const m of machineSummary(ctx, db)) {
        out(`${shortId(m.id)}  ${m.label ?? '-'}  ${m.sessions} sessions${m.current ? '  (this machine)' : ''}\n`);
      }
    } finally {
      db.close();
    }
    return 0;
  }
  if (action === 'set-label' && rest.length === 1) {
    const label = (rest[0] as string).trim();
    if (label === '') throw usage('label must not be empty');
    setMachineLabel(ctx, label);
    out(`label set to ${label}\n`);
    return 0;
  }
  throw usage('machine needs: show | set-label <label>');
};

export const importCommand: Command = async (args, env) => {
  const [what] = args;
  if (what === 'claude-ai') {
    env.io.stderr.write('error: import claude-ai is not implemented yet\n');
    return 2;
  }
  throw usage('import needs a source: claude-ai');
};

import { listSessions, machineSummary, openDb, type ListSessionsOptions } from 'threadkeep-core';
import { intFlag, oneOf, parse, str } from '../args.js';
import { formatTime, jsonOut, machineName, oneLine, projectName, shortId } from '../format.js';
import { usage, type Command } from '../types.js';

export const sessionsCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, {
    source: { type: 'string' },
    project: { type: 'string' },
    since: { type: 'string' },
    until: { type: 'string' },
    machine: { type: 'string' },
    sort: { type: 'string' },
    limit: { type: 'string' },
    json: { type: 'boolean' },
  });
  if (positionals.length > 0) throw usage('sessions takes no positional arguments');
  const ctx = env.context(str(values['home']));
  const options: ListSessionsOptions = {
    sort: oneOf(values['sort'], 'sort', ['time', 'project', 'source', 'length'] as const) ?? 'time',
    limit: intFlag(values['limit'], 'limit', 50),
  };
  for (const key of ['source', 'project', 'since', 'until'] as const) {
    const value = str(values[key]);
    if (value) options[key] = value;
  }
  const db = openDb(ctx.dbPath);
  try {
    const machines = machineSummary(ctx, db);
    const machine = str(values['machine']);
    if (machine) {
      const found = machines.find((m) => m.id === machine || m.label === machine || m.id.startsWith(machine));
      options.machine = found?.id ?? machine;
    }
    const sessions = listSessions(db, options);
    if (values['json']) {
      env.io.stdout.write(
        jsonOut(
          sessions.map((s) => ({ ...s, project: projectName(s.project_dir), machine: machineName(machines, s.machine_id) })),
        ),
      );
      return 0;
    }
    for (const s of sessions) {
      const columns = [
        formatTime(s.started_at),
        shortId(s.id),
        s.source,
        machineName(machines, s.machine_id),
        String(s.event_count),
        projectName(s.project_dir),
        oneLine(s.title ?? ''),
      ];
      env.io.stdout.write(`${columns.join('  ')}\n`);
    }
    return 0;
  } finally {
    db.close();
  }
};

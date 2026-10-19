import { machineSummary, openDb, search, type SearchOptions } from '@hansard/core';
import { intFlag, oneOf, parse, str } from '../args.js';
import { formatTime, jsonOut, oneLine, projectName, shortId } from '../format.js';
import { usage, type Command } from '../types.js';

export const searchCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, {
    source: { type: 'string' },
    project: { type: 'string' },
    since: { type: 'string' },
    until: { type: 'string' },
    role: { type: 'string' },
    machine: { type: 'string' },
    sort: { type: 'string' },
    thinking: { type: 'boolean' },
    limit: { type: 'string' },
    json: { type: 'boolean' },
  });
  if (positionals.length === 0) throw usage('search needs a query');
  const ctx = env.context(str(values['home']));
  const options: SearchOptions = {
    query: positionals.join(' '),
    sort: oneOf(values['sort'], 'sort', ['time', 'rank'] as const) ?? 'rank',
    thinking: values['thinking'] === true,
    limit: intFlag(values['limit'], 'limit', 20),
  };
  for (const key of ['source', 'project', 'since', 'until', 'role'] as const) {
    const value = str(values[key]);
    if (value) options[key] = value;
  }
  const db = openDb(ctx.dbPath);
  try {
    const machine = str(values['machine']);
    if (machine) {
      const found = machineSummary(ctx, db).find(
        (m) => m.id === machine || m.label === machine || m.id.startsWith(machine),
      );
      options.machine = found?.id ?? machine;
    }
    const hits = search(db, options);
    if (values['json']) {
      env.io.stdout.write(jsonOut(hits));
      return 0;
    }
    for (const hit of hits) {
      const when = formatTime(hit.timestamp);
      const where = projectName(hit.project_dir);
      env.io.stdout.write(`${when}  ${shortId(hit.session_id)}  ${hit.role}  ${where}  ${oneLine(hit.snippet)}\n`);
    }
    return 0;
  } finally {
    db.close();
  }
};

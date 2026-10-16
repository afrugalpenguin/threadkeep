import { getSession, openDb } from '@hansard/core';
import { parse, str } from '../args.js';
import { formatTime, jsonOut, projectName } from '../format.js';
import { usage, type Command } from '../types.js';

export const showCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, {
    'expand-tools': { type: 'boolean' },
    thinking: { type: 'boolean' },
    json: { type: 'boolean' },
  });
  if (positionals.length !== 1) throw usage('show needs exactly one session id');
  const ctx = env.context(str(values['home']));
  const db = openDb(ctx.dbPath);
  try {
    const shown = getSession(db, positionals[0] as string, {
      thinking: values['thinking'] === true,
      expandTools: values['expand-tools'] === true,
    });
    if (values['json']) {
      env.io.stdout.write(jsonOut(shown));
      return 0;
    }
    const { session, events } = shown;
    const out = (s: string) => env.io.stdout.write(s);
    out(`session ${session.id}\n`);
    out(`title: ${session.title ?? ''}\n`);
    out(`source: ${session.source}  project: ${projectName(session.project_dir)}  events: ${session.event_count}\n\n`);
    for (const e of events) {
      const label = e.kind === 'tool' ? `tool ${e.tool_name ?? ''}`.trim() : e.kind === 'thinking' ? 'thinking' : e.role;
      out(`[${formatTime(e.timestamp)}] ${label}\n`);
      const body = e.content.length > 0 ? e.content : e.attachments.length > 0 ? '(attachment only)' : '';
      out(`${body.replace(/^/gm, '  ')}\n`);
      if (e.attachments.length > 0 && e.content.length > 0) out(`  (${e.attachments.length} attachment(s))\n`);
    }
    return 0;
  } finally {
    db.close();
  }
};

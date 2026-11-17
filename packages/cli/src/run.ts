import os from 'node:os';
import {
  AmbiguousError,
  BusyError,
  NotFoundError,
  UsageError,
  loadContext,
  safeMessage,
  type PathRoots,
} from 'threadkeep-core';
import { commands } from './commands.js';
import { ExitError, type CommandEnv, type Io } from './types.js';

export type { Command, CommandEnv, Io, Output } from './types.js';

export const HELP = `usage: threadkeep <command> [options]

commands:
  ingest [path]       mirror local sources into the archive and ingest them
  search <query...>   full text search
  sessions            list sessions
  show <session_id>   print a session
  rebuild             rebuild the database from the archive
  exclusions          list | add | remove exclusions
  sources             list known sources
  machine             show | set-label <label>
  doctor              check the setup
  watch               ingest on change
  ui                  serve the local web ui (--port, --open)
  import claude-ai <path...>  import claude.ai export zips, a directory or a manifest

every command accepts --home <dir> (default: THREADKEEP_HOME, else ~/.threadkeep)
exit codes: 0 ok, 1 error or not found, 2 usage, 3 busy
`;

function userHomeFrom(env: Record<string, string | undefined>): string {
  const fromEnv = process.platform === 'win32' ? (env['USERPROFILE'] ?? env['HOME']) : env['HOME'];
  return fromEnv ?? os.homedir();
}

export async function run(
  argv: string[],
  io: Io,
  env: Record<string, string | undefined> = process.env,
  signal?: AbortSignal,
): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    io.stdout.write(HELP);
    return name === undefined ? 2 : 0;
  }
  const command = commands[name];
  if (!command) {
    io.stderr.write(`error: unknown command: ${name}\n${HELP}`);
    return 2;
  }
  // Roots we can see so far, used to keep absolute paths out of error output even if loading the context failed.
  let known: PathRoots = { userHome: userHomeFrom(env), home: env['THREADKEEP_HOME'] };
  const commandEnv: CommandEnv = {
    io,
    env,
    ...(signal ? { signal } : {}),
    context(home) {
      const options: Parameters<typeof loadContext>[0] = { env, userHome: userHomeFrom(env) };
      if (home) {
        options.home = home;
        known = { ...known, home };
      }
      const ctx = loadContext(options);
      known = ctx;
      if (ctx.created.includes('<home>/config.json')) io.stderr.write('created config at <home>/config.json\n');
      return ctx;
    },
  };
  try {
    return await command(rest, commandEnv);
  } catch (error) {
    if (error instanceof ExitError) {
      io.stderr.write(`error: ${error.message}\n`);
      return error.code;
    }
    if (error instanceof BusyError) {
      io.stderr.write('error: busy, another threadkeep run holds the ingest lock\n');
      return 3;
    }
    if (error instanceof UsageError) {
      io.stderr.write(`error: ${error.message}\n`);
      return 2;
    }
    if (error instanceof NotFoundError || error instanceof AmbiguousError) {
      io.stderr.write(`error: ${error.message}\n`);
      return 1;
    }
    // parseArgs throws TypeErrors with a code for bad flags.
    if (error instanceof TypeError && (error as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS')) {
      io.stderr.write(`error: ${error.message}\n`);
      return 2;
    }
    io.stderr.write(`error: ${safeMessage(known, error)}\n`);
    return 1;
  }
}


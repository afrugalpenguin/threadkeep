import { spawn } from 'node:child_process';
import { displayPath } from '@hansard/core';
import { intFlag, parse, str } from '../args.js';
import { ExitError, usage, type Command } from '../types.js';

// rundll32 avoids cmd.exe quoting rules on Windows (`start ""` gets mangled by Node's argument quoting).
function openBrowser(url: string, onError: () => void): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', onError);
    child.unref();
  } catch {
    onError();
  }
}

export const uiCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, { port: { type: 'string' }, open: { type: 'boolean' } });
  if (positionals.length > 0) throw usage('ui takes no positional arguments');
  const port = intFlag(values['port'], 'port', 4477);
  if (port > 65535) throw usage('--port must be at most 65535');
  const ctx = env.context(str(values['home']));
  // Lazy so that other commands never load the web server.
  const { startServer } = await import('@hansard/server');
  let server;
  try {
    server = await startServer(ctx, { port, log: (line) => env.io.stderr.write(`${line}\n`) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new ExitError(`port ${port} is in use, pick another with --port`, 1);
    }
    throw error;
  }
  env.io.stdout.write(`listening on ${server.url}\ndatabase: ${displayPath(ctx, ctx.dbPath)}\npress ctrl+c to stop\n`);
  if (values['open']) openBrowser(server.url, () => env.io.stderr.write('could not open a browser, visit the url above\n'));
  await new Promise<void>((resolve) => {
    if (env.signal?.aborted) return resolve();
    env.signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  await server.close();
  return 0;
};

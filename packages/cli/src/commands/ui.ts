import { spawn } from 'node:child_process';
import path from 'node:path';
import { displayPath } from '@hansard/core';
import { intFlag, parse, str } from '../args.js';
import { ExitError, usage, type Command } from '../types.js';
import { UI_TOKEN_PROBLEM, readUiToken } from '../ui-token.js';

export interface Opener {
  command: string;
  args: string[];
  // Pass args to CreateProcess untouched (Windows only), because cmd.exe does its own quote parsing.
  verbatim: boolean;
}

// Only ever a link this program built: loopback, a port, and a hex token. Checking the exact shape
// is what makes it safe to hand the string to cmd.exe on Windows.
const OPENABLE = /^http:\/\/127\.0\.0\.1:\d{1,5}\/#token=[0-9a-f]{32,}$/;

// `start` goes through ShellExecute and hands the full URL, fragment included, to the default
// browser. rundll32 url.dll,FileProtocolHandler was used before, but how it treats a fragment is
// undocumented and losing `#token=` would leave the page locked. Nothing needs cmd.exe escaping
// because OPENABLE allows no cmd metacharacter (& | ^ % " < > or spaces).
// Full path so a planted cmd.exe in the current directory or PATH is never picked up.
const cmdPath = (): string => path.win32.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'cmd.exe');

export function openerFor(platform: NodeJS.Platform, url: string): Opener | null {
  if (!OPENABLE.test(url)) return null;
  if (platform === 'win32') return { command: cmdPath(), args: ['/d', '/s', '/c', `"start "" "${url}""`], verbatim: true };
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', args: [url], verbatim: false };
}

function openBrowser(url: string, onError: () => void): void {
  const opener = openerFor(process.platform, url);
  if (!opener) return onError();
  try {
    const child = spawn(opener.command, opener.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: opener.verbatim,
    });
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
  let token: string | null;
  try {
    token = readUiToken(ctx);
  } catch {
    throw new ExitError(UI_TOKEN_PROBLEM, 1);
  }
  // Lazy so that other commands never load the web server.
  const { startServer } = await import('@hansard/server');
  let server;
  try {
    server = await startServer(ctx, { port, ...(token ? { token } : {}), log: (line) => env.io.stderr.write(`${line}\n`) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new ExitError(`port ${port} is in use, pick another with --port`, 1);
    }
    throw error;
  }
  env.io.stdout.write(
    `listening on ${server.url}\nopen ${server.openUrl}\ndatabase: ${displayPath(ctx, ctx.dbPath)}\npress ctrl+c to stop\n`,
  );
  if (values['open']) openBrowser(server.openUrl, () => env.io.stderr.write('could not open a browser, visit the link above\n'));
  await new Promise<void>((resolve) => {
    if (env.signal?.aborted) return resolve();
    env.signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  await server.close();
  return 0;
};

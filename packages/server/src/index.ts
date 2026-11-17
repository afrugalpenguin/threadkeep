import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { UsageError, type HansardContext } from 'threadkeep-core';
import { createApp } from './app.js';

export { createApp, type AppOptions } from './app.js';
export { MARK_CLOSE, MARK_OPEN } from './shared/marks.js';

export interface StartOptions {
  port: number;
  log?: (line: string) => void;
  publicDir?: string;
  // Fixed token (lowercase hex, 32 or more characters); a random one is generated per run when omitted.
  token?: string;
}

export interface RunningServer {
  // Bare base URL, no token.
  url: string;
  // Base URL plus the token fragment: the link to give the user.
  openUrl: string;
  port: number;
  close(): Promise<void>;
}

export const TOKEN_FORMAT = /^[0-9a-f]{32,}$/;

export const defaultPublicDir = (): string => fileURLToPath(new URL('./public/', import.meta.url));

export async function startServer(ctx: HansardContext, options: StartOptions): Promise<RunningServer> {
  const log = options.log ?? (() => {});
  const publicDir = options.publicDir ?? defaultPublicDir();
  if (!fs.existsSync(path.join(publicDir, 'app.js'))) log('warning: client bundle missing, run pnpm build');
  if (options.token !== undefined && !TOKEN_FORMAT.test(options.token)) {
    throw new UsageError('ui token must be at least 32 lowercase hex characters');
  }
  const token = options.token ?? randomBytes(24).toString('hex');
  const app = createApp(ctx, { token, port: options.port, publicDir, log });
  try {
    await app.listen({ host: '127.0.0.1', port: options.port });
  } catch (error) {
    // createApp opened the db; release it so a failed bind does not leak the handle.
    await app.close();
    throw error;
  }
  const port = (app.server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/`;
  return { url, openUrl: `${url}#token=${token}`, port, close: async () => void (await app.close()) };
}

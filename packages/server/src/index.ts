import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { HansardContext } from '@hansard/core';
import { createApp } from './app.js';

export { createApp, type AppOptions } from './app.js';
export { MARK_CLOSE, MARK_OPEN } from './shared/marks.js';

export interface StartOptions {
  port: number;
  log?: (line: string) => void;
  publicDir?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export const defaultPublicDir = (): string => fileURLToPath(new URL('./public/', import.meta.url));

export async function startServer(ctx: HansardContext, options: StartOptions): Promise<RunningServer> {
  const log = options.log ?? (() => {});
  const publicDir = options.publicDir ?? defaultPublicDir();
  if (!fs.existsSync(path.join(publicDir, 'app.js'))) log('warning: client bundle missing, run pnpm build');
  const app = createApp(ctx, { token: randomBytes(24).toString('hex'), port: options.port, publicDir, log });
  try {
    await app.listen({ host: '127.0.0.1', port: options.port });
  } catch (error) {
    // createApp opened the db; release it so a failed bind does not leak the handle.
    await app.close();
    throw error;
  }
  const port = (app.server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/`, port, close: async () => void (await app.close()) };
}

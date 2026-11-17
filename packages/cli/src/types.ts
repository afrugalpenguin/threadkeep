import type { HansardContext } from 'threadkeep-core';

export interface Output {
  write(text: string): unknown;
}

export interface Io {
  stdout: Output;
  stderr: Output;
}

export interface CommandEnv {
  io: Io;
  // Aborts long-running commands such as watch.
  signal?: AbortSignal;
  env: Record<string, string | undefined>;
  // Loads (and on first run creates) the data dir, printing where config was created.
  context(home: string | undefined): HansardContext;
}

export class ExitError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

export const usage = (message: string): ExitError => new ExitError(message, 2);

export type Command = (args: string[], env: CommandEnv) => Promise<number>;


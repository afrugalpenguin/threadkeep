import { parseArgs, type ParseArgsConfig } from 'node:util';
import { usage } from './types.js';

type Options = NonNullable<ParseArgsConfig['options']>;

export interface Parsed {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

// Strict flag parsing; every command also accepts --home.
export function parse(args: string[], options: Options): Parsed {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: { home: { type: 'string' }, ...options },
  });
  return { values: values as Parsed['values'], positionals };
}

export const str = (v: string | boolean | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

export function intFlag(v: string | boolean | undefined, name: string, fallback: number): number {
  if (typeof v !== 'string') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw usage(`--${name} must be a non-negative integer`);
  return n;
}

export function oneOf<T extends string>(
  v: string | boolean | undefined,
  name: string,
  allowed: readonly T[],
): T | undefined {
  if (typeof v !== 'string') return undefined;
  if (!(allowed as readonly string[]).includes(v)) throw usage(`--${name} must be one of: ${allowed.join(', ')}`);
  return v as T;
}

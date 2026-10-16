import fs from 'node:fs';
import type { HansardContext } from '@hansard/core';

const FORMAT = /^[0-9a-f]{32,}$/;

export const UI_TOKEN_PROBLEM = 'config.json ui.token must be at least 32 lowercase hex characters';

// The optional fixed token from config.json (`ui.token`), or null for a fresh token per run.
// Throws without ever including the configured value.
export function readUiToken(ctx: HansardContext): string | null {
  let config: unknown;
  try {
    config = JSON.parse(fs.readFileSync(ctx.configPath, 'utf8'));
  } catch {
    return null; // an unreadable config is already reported by loading the context and by doctor
  }
  const ui = (config as { ui?: unknown } | null)?.ui;
  if (ui === undefined || ui === null) return null;
  const token = (ui as { token?: unknown }).token;
  if (token === undefined) return null;
  if (typeof token !== 'string' || !FORMAT.test(token)) throw new Error(UI_TOKEN_PROBLEM);
  return token;
}

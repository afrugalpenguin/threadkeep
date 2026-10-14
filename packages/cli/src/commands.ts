import type { Command } from './types.js';
import { ingestCommand } from './commands/ingest.js';
import { searchCommand } from './commands/search.js';
import { sessionsCommand } from './commands/sessions.js';
import { showCommand } from './commands/show.js';

export const commands: Record<string, Command> = {
  ingest: ingestCommand,
  search: searchCommand,
  sessions: sessionsCommand,
  show: showCommand,
};

import type { Command } from './types.js';
import { ingestCommand } from './commands/ingest.js';
import { searchCommand } from './commands/search.js';
import { sessionsCommand } from './commands/sessions.js';
import { doctorCommand } from './commands/doctor.js';
import { showCommand } from './commands/show.js';
import {
  exclusionsCommand,
  importCommand,
  machineCommand,
  rebuildCommand,
  sourcesCommand,
} from './commands/simple.js';
import { watchCommand } from './commands/watch.js';

export const commands: Record<string, Command> = {
  ingest: ingestCommand,
  search: searchCommand,
  sessions: sessionsCommand,
  show: showCommand,
  rebuild: rebuildCommand,
  exclusions: exclusionsCommand,
  sources: sourcesCommand,
  machine: machineCommand,
  doctor: doctorCommand,
  watch: watchCommand,
  import: importCommand,
};

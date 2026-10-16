import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expandHome, relativeWithin, toPosix } from './paths.js';

export interface SourceConfig {
  root: string;
}

export interface HansardConfig {
  dbPath: string;
  archiveRoot: string;
  sources: Record<string, SourceConfig>;
}

export interface ExclusionsFile {
  projectGlobs: string[];
  sessionIds: string[];
}

export interface HansardContext {
  home: string;
  userHome: string;
  env: Record<string, string | undefined>;
  configPath: string;
  exclusionsPath: string;
  machinePath: string;
  hooksLogPath: string;
  lockPath: string;
  dbPath: string;
  archiveRoot: string;
  // Absolute, home-expanded local origin roots keyed by adapter id.
  sources: Record<string, SourceConfig>;
  machineId: string;
  machineLabel: string | null;
  // Files created by this call (first run), as display paths.
  created: string[];
}

export interface LoadContextOptions {
  home?: string;
  env?: Record<string, string | undefined>;
  // Base for "~" expansion and the default data dir. Injected by tests.
  userHome?: string;
  overrides?: Partial<HansardConfig>;
}

export const DEFAULT_CONFIG: HansardConfig = {
  dbPath: '<home>/history.db',
  archiveRoot: '<home>/archive',
  sources: { 'claude-code': { root: '~/.claude/projects' } },
};

// Display form of a path that never reveals an absolute home directory.
export interface PathRoots {
  home?: string | undefined;
  userHome?: string | undefined;
  archiveRoot?: string | undefined;
}

export function displayPath(ctx: PathRoots, abs: string): string {
  const within = (root: string | undefined) => (root ? relativeWithin(root, abs) : null);
  const rel = within(ctx.archiveRoot);
  if (rel !== null) return rel === '' ? '<archive>' : `<archive>/${rel}`;
  const inHome = within(ctx.home);
  if (inHome !== null) return inHome === '' ? '<home>' : `<home>/${inHome}`;
  const inUser = within(ctx.userHome);
  if (inUser !== null) return inUser === '' ? '~' : `~/${inUser}`;
  return `<external>/${toPosix(abs).split('/').filter(Boolean).pop() ?? ''}`;
}

function writeJsonIfMissing(file: string, value: unknown): boolean {
  if (fs.existsSync(file)) return false;
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  return true;
}

function readJson<T>(file: string, what: string): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    throw new Error(`${what} is not valid JSON`);
  }
}

export function loadContext(options: LoadContextOptions = {}): HansardContext {
  const env = options.env ?? process.env;
  const userHome = options.userHome ?? os.homedir();
  const home = path.resolve(options.home ?? env['HANSARD_HOME'] ?? path.join(userHome, '.hansard'));
  fs.mkdirSync(home, { recursive: true });

  const configPath = path.join(home, 'config.json');
  const exclusionsPath = path.join(home, 'exclusions.json');
  const machinePath = path.join(home, 'machine.json');
  const created: string[] = [];

  // "<home>" and "~" are stored literally so the file holds no absolute home path.
  const defaults: HansardConfig = { ...DEFAULT_CONFIG };
  if (writeJsonIfMissing(configPath, defaults)) created.push('<home>/config.json');
  if (writeJsonIfMissing(exclusionsPath, { projectGlobs: [], sessionIds: [] })) created.push('<home>/exclusions.json');
  if (writeJsonIfMissing(machinePath, { id: randomUUID(), label: null })) created.push('<home>/machine.json');

  const config = { ...readJson<HansardConfig>(configPath, 'config.json'), ...options.overrides };
  const machine = readJson<{ id: string; label: string | null }>(machinePath, 'machine.json');
  if (typeof machine.id !== 'string' || machine.id.length === 0) throw new Error('machine.json has no id');

  const resolve = (p: string): string => {
    if (p.startsWith('<home>')) return path.join(home, p.slice('<home>'.length));
    return path.resolve(expandHome(p, userHome));
  };

  const sources: Record<string, SourceConfig> = {};
  for (const [id, source] of Object.entries(config.sources ?? {})) sources[id] = { root: resolve(source.root) };

  return {
    home,
    userHome,
    env,
    configPath,
    exclusionsPath,
    machinePath,
    hooksLogPath: path.join(home, 'hooks.log'),
    lockPath: path.join(home, 'ingest.lock'),
    dbPath: resolve(config.dbPath),
    archiveRoot: resolve(config.archiveRoot),
    sources,
    machineId: machine.id,
    machineLabel: machine.label ?? null,
    created,
  };
}

export function readExclusions(ctx: HansardContext): ExclusionsFile {
  const parsed = readJson<Partial<ExclusionsFile>>(ctx.exclusionsPath, 'exclusions.json');
  return {
    projectGlobs: Array.isArray(parsed.projectGlobs) ? parsed.projectGlobs.map(String) : [],
    sessionIds: Array.isArray(parsed.sessionIds) ? parsed.sessionIds.map(String) : [],
  };
}

export function writeExclusions(ctx: HansardContext, value: ExclusionsFile): void {
  fs.writeFileSync(ctx.exclusionsPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function setMachineLabel(ctx: HansardContext, label: string | null): void {
  fs.writeFileSync(ctx.machinePath, `${JSON.stringify({ id: ctx.machineId, label }, null, 2)}\n`);
  ctx.machineLabel = label;
  writeMachineArchiveFile(ctx);
}

// Lets other machines sharing the archive show this machine's label.
export function writeMachineArchiveFile(ctx: HansardContext): void {
  const dir = path.join(ctx.archiveRoot, 'machines');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${ctx.machineId}.json`),
    `${JSON.stringify({ id: ctx.machineId, label: ctx.machineLabel }, null, 2)}\n`,
  );
}

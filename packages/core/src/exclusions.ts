import { readExclusions, writeExclusions, type ExclusionsFile, type HansardContext } from './config.js';
import { toPosix } from './paths.js';
import type { Db } from './store/db.js';

const SPECIAL = /[.+^${}()|[\]\\]/g;

// Case-insensitive, slash style agnostic. `**` matches any characters, `*` anything but '/', `?` one character.
// A trailing `/**` also matches the directory itself, so `/x/secret/**` covers `/x/secret` and everything below.
// Anything else is exact: `**/projects/secret` matches that directory only, not its children.
export function globToRegExp(glob: string): RegExp {
  let g = toPosix(glob);
  const subtree = g.endsWith('/**');
  if (subtree) g = g.slice(0, -3);
  let out = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i] as string;
    if (c === '*' && g[i + 1] === '*') {
      out += '.*';
      i += 1;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '.';
    else out += c.replace(SPECIAL, '\\$&');
  }
  return new RegExp(`^${out}${subtree ? '(?:/.*)?' : ''}/?$`, 'i');
}

export function matchesGlob(value: string, glob: string): boolean {
  return globToRegExp(glob).test(toPosix(value));
}

// A session is excluded when its id is listed or any project dir seen in it matches a glob.
// With no ids, every session is recomputed (exclusions changed, or rebuild).
export function applyExclusions(db: Db, exclusions: ExclusionsFile, ids?: Iterable<string>): void {
  const targets = ids ? [...new Set(ids)] : (db.prepare('select id from sessions').all() as { id: string }[]).map((r) => r.id);
  const regexes = exclusions.projectGlobs.map(globToRegExp);
  const dirs = db.prepare(
    'select project_dir as d from sessions where id = ? and project_dir is not null union select project_dir from events where session_id = ? and project_dir is not null',
  );
  const set = db.prepare('update sessions set excluded = ? where id = ?');
  const listed = new Set(exclusions.sessionIds);
  for (const id of targets) {
    let excluded = listed.has(id);
    if (!excluded && regexes.length > 0) {
      excluded = (dirs.all(id, id) as { d: string }[]).some(({ d }) => regexes.some((re) => re.test(toPosix(d))));
    }
    set.run(excluded ? 1 : 0, id);
  }
}

export type ExclusionChange = { kind: 'project' | 'session'; value: string };

// Writes exclusions.json then recomputes the flag for every session. Returns false when nothing changed.
export function changeExclusion(ctx: HansardContext, db: Db, op: 'add' | 'remove', change: ExclusionChange): boolean {
  const value = change.value.trim();
  if (value === '') throw new Error('exclusion value must not be empty');
  const current = readExclusions(ctx);
  const key = change.kind === 'project' ? 'projectGlobs' : 'sessionIds';
  const list = current[key];
  const present = list.includes(value);
  if (op === 'add' && present) return false;
  if (op === 'remove' && !present) return false;
  current[key] = op === 'add' ? [...list, value] : list.filter((v) => v !== value);
  writeExclusions(ctx, current);
  db.transaction(() => applyExclusions(db, current))();
  return true;
}

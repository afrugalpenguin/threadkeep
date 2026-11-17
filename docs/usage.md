# Using Threadkeep

For anyone running `threadkeep` day to day: read this when you want a flag, an exit code or the exact rules for dates.

## How do I install, upgrade or remove it?

You need Node 22 or newer and git. The install script also needs pnpm: Node 22 and 24 bundle it through corepack, so `corepack pnpm --version` working is enough. Node 25 and later no longer ship corepack, so there run `npm install -g pnpm` (or `npm install -g corepack`) first.

```sh
git clone https://github.com/afrugalpenguin/threadkeep.git
cd threadkeep
node scripts/install.mjs
```

The install script installs dependencies from the lockfile, builds every package and writes a `threadkeep` launcher into npm's global bin directory (the directory `npm prefix -g` prints, plus `/bin` outside Windows), which npm already keeps on your PATH. On Windows it writes `threadkeep.cmd` for cmd and PowerShell and a `threadkeep` sh launcher for Git Bash.

- **Upgrade:** the launcher runs the CLI from your checkout, so pull and rerun the script.
- **Existing launchers:** the script never replaces a `threadkeep` launcher it did not write.
- **Build only:** `node scripts/install.mjs --no-link` builds without writing the launcher; call `node packages/cli/dist/index.js` instead of `threadkeep`.
- **Long paths on Windows:** some test fixture paths are about 120 characters, so cloning under a very deep folder can fail with `Filename too long`. Clone somewhere shorter, or run `git config --global core.longpaths true` first.
- **Uninstall:** delete the launcher (`threadkeep` and, on Windows, `threadkeep.cmd`) from that directory, and delete `~/.threadkeep` if you want the data gone too.

## What do all the commands share?

- `--home <dir>` on every command uses another data directory. Without it, `THREADKEEP_HOME` is used, else `~/.threadkeep`. See [data.md](data.md).
- `threadkeep --help` (or `-h`, or `help`) lists every command.

### Exit codes

| code | meaning |
| --- | --- |
| 0 | success, including a search with no hits |
| 1 | an error, a failed file during ingest, or a session that was not found |
| 2 | bad usage: an unknown flag, a missing argument or an invalid value |
| 3 | busy: another ingest holds the lock for longer than `--wait` |

## `threadkeep ingest [path]`

Copies new session data into the archive and indexes it. The first ingest copies every session file and indexes it. Later runs only read what is new: files that have not changed are skipped, and lines appended to a session since the last run are picked up without touching anything already stored. Running it twice in a row inserts nothing the second time. Run it whenever you want your history up to date, or from a scheduled task.

| option | effect |
| --- | --- |
| `[path]` | ingest one session file instead of every source |
| `--verbose` | also list files that were unchanged or skipped |
| `--wait <ms>` | how long to wait for another ingest to release the lock (default 30000) before exiting with code 3 |

Ingest prints a line for every file that had new content, a summary, and a `warning:` line (on stderr) for anything it skipped or could not read, with the reason. A file that fails does not stop the run; the run finishes the other files and then exits with status 1.

Output from the synthetic sessions in `tests/fixtures`:

```
$ threadkeep ingest
progress 3/3 files
ingested  raw/claude-code/b1f70da0-.../-home-alice-projects-demo/aaaaaaaa-0000-4000-8000-000000000001.jsonl  +5 events  +6 records
ingested  raw/claude-code/b1f70da0-.../-home-alice-projects-demo/aaaaaaaa-0000-4000-8000-000000000002.jsonl  +5 events  +8 records
ingested  raw/claude-code/b1f70da0-.../C--Users-alice-projects-notes/aaaaaaaa-0000-4000-8000-000000000003.jsonl  +3 events  +5 records
mirrored 3 files, 8856 bytes
ingested 3 files, 13 new events, 19 new records
scanned 3 source files, 3 archive files: 3 ingested, 0 unchanged, 0 skipped, 0 failed
warning: unparseable line at offset 2321 in raw/claude-code/b1f70da0-.../-home-alice-projects-demo/aaaaaaaa-0000-4000-8000-000000000002.jsonl
```

That warning is deliberate: one fixture contains a line cut off mid write. Such lines are kept as raw records but not indexed.

## `threadkeep search <query...>`

Full text search over every message, tool call and tool result. Each word in the query must match; there is no query syntax to learn or escape. Hits are ranked best first and show time, session id prefix, role, project and a snippet with the matches in brackets.

```
$ threadkeep search kestrel
2026-03-09 14:00  aaaaaaaa  user  demo  Why does the [kestrel] worker drop jobs on restart? Screenshot of the...
2026-03-09 14:00  aaaaaaaa  assistant  demo  The [kestrel] worker exits without draining its queue. Await the drain before...
```

| option | effect |
| --- | --- |
| `--project <text>` | only projects whose directory contains this text (case-insensitive) |
| `--since <when>` | on or after a time; see [date ranges](#how-do-date-ranges-work) |
| `--until <when>` | before a time; a bare date includes the whole day |
| `--role <role>` | `user`, `assistant`, `tool` or `system` |
| `--source <id>` | only one source, such as `claude-code` |
| `--machine <id or label>` | only sessions from one machine, by id, id prefix or label (see `threadkeep machine`) |
| `--sort rank\|time` | `rank` (default) is best match first; `time` is newest first |
| `--thinking` | include the assistant's thinking blocks |
| `--limit <n>` | number of hits (default 20) |
| `--json` | full session ids and fields as JSON |

```sh
threadkeep search migration --project api --since 2w
threadkeep search "deploy failed" --since 2026-10-12 --until 2026-10-18 --sort time
threadkeep search retry --role tool --limit 5 --json
```

## `threadkeep sessions`

Recent sessions, newest first: start time, session id prefix, source, machine, event count, project and title.

```
$ threadkeep sessions
2026-03-16 16:30  aaaaaaaa  claude-code  b1f70da0  3  notes  List the action items from the quarterly planning notes.
2026-03-09 14:00  aaaaaaaa  claude-code  b1f70da0  5  demo  Kestrel worker drops jobs on restart
2026-03-02 09:15  aaaaaaaa  claude-code  b1f70da0  5  demo  Shrinking the demo sqlite file
```

| option | effect |
| --- | --- |
| `--project <text>` | as for search |
| `--since <when>`, `--until <when>` | filter on the session's start time; see [date ranges](#how-do-date-ranges-work) |
| `--source <id>`, `--machine <id or label>` | as for search |
| `--sort time\|project\|source\|length` | `time` (default) is newest first; `length` is most events first |
| `--limit <n>` | number of sessions (default 50) |
| `--json` | full ids and fields as JSON, including the project name and machine label |

```sh
threadkeep sessions --since 7d
threadkeep sessions --project demo --sort length --limit 10
```

## `threadkeep show <session_id>`

Replays one session as a transcript. The id can be any prefix that matches exactly one session; `threadkeep sessions --json` and `threadkeep search --json` print full ids. A prefix that matches more than one session is an error.

| option | effect |
| --- | --- |
| `--expand-tools` | print each tool call's full input and output instead of one line |
| `--thinking` | include thinking blocks |
| `--json` | the session as JSON |

Without `--expand-tools`, each tool call is one line: the tool name and a summary of its input, such as the file it read or the command it ran.

```
$ threadkeep show aaaaaaaa-0000-4000-8000-000000000002
session aaaaaaaa-0000-4000-8000-000000000002
title: Kestrel worker drops jobs on restart
source: claude-code  project: demo  events: 5

[2026-03-09 14:00] system
  Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages.
[2026-03-09 14:00] user
  Why does the kestrel worker drop jobs on restart? Screenshot of the log attached.
  (1 attachment(s))
[2026-03-09 14:00] tool Read: /home/alice/projects/demo/src/worker.ts
[2026-03-09 14:00] system
  <task-notification>Background build finished with exit code 0.</task-notification>
[2026-03-09 14:00] assistant
  The kestrel worker exits without draining its queue. Await the drain before calling process.exit.
```

Lines that Claude Code generated itself (caveats, task notifications, hook output) are shown with the `system` role rather than `user`.

## How do date ranges work?

`--since` and `--until` take either form:

- **A date or time:** `2026-10-01`, `2026-10-01T09:00Z` or `2026-10-01 09:00`. Times are compared with the UTC timestamps Claude Code writes, so write times in UTC.
- **A duration back from now:** a number followed by `h`, `d` or `w`, such as `12h`, `7d` or `2w`.

`--since` is inclusive: on or after that time. `--until` is exclusive: before that time. A bare date given to `--until` means the end of that day, so `--since 2026-10-12 --until 2026-10-18` covers the 12th to the 18th inclusive. Anything else is a usage error (exit 2).

## `threadkeep doctor`

Checks the setup and reports what is stored: the database and its schema version, the archive, session and event counts, archive size, each source, and whether `threadkeep` is on your PATH. It exits 1 if any check fails; warnings do not change the exit code.

```
$ threadkeep doctor
...
ok    database: <home>/history.db schema version 2
ok    contents: 3 sessions, 13 events
ok    archive size: 8.9 KB (8924 bytes) in 4 files
...
```

It also warns `mcp server: not built yet`; that is expected in v0.1 (see [roadmap.md](roadmap.md)).

## Other commands

These exist but are not part of the v0.1 core. The last three are outside v0.1 entirely (see [roadmap.md](roadmap.md)).

| command | what it does |
| --- | --- |
| `threadkeep exclusions list` | list excluded project globs and session ids |
| `threadkeep exclusions add --project <glob>` or `--session <id>` | hide matching sessions; see [privacy.md](privacy.md#how-do-i-keep-a-project-out-of-results) for the glob rules |
| `threadkeep exclusions remove --project <glob>` or `--session <id>` | bring them back |
| `threadkeep rebuild [--wait <ms>]` | recreate the database from the archive alone |
| `threadkeep sources [--json]` | list the sources Threadkeep knows and whether each was found |
| `threadkeep machine show` | this machine's id and label, and session counts per machine |
| `threadkeep machine set-label <label>` | name this machine in listings and in `--machine` |
| `threadkeep watch [--debounce <ms>]` | ingest each session file when it changes (default debounce 500 ms) |
| `threadkeep ui [--port <n>] [--open]` | serve the local web UI on 127.0.0.1 |
| `threadkeep import claude-ai <path...> [--wait <ms>]` | import claude.ai export zips, a directory of them or a manifest |

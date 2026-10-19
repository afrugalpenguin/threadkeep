# Hansard

Hansard keeps a searchable, local archive of your Claude Code sessions. It copies the session files Claude Code writes under `~/.claude/projects` into its own archive, indexes them in SQLite with full text search, and gives you three commands to use them: `search`, `sessions` and `show`.

Everything stays on your machine. There is no account, no server, no telemetry and no network access.

This is v0.1: Claude Code sessions and the command line only. What comes later is in [ROADMAP.md](ROADMAP.md).

## Requirements

- Node 22 or newer
- pnpm. Node ships it through corepack, so `corepack pnpm --version` working is enough. Otherwise run `corepack enable` or `npm install -g pnpm`.
- git, to clone the repository

## Install

```sh
git clone https://github.com/afrugalpenguin/hansard.git
cd hansard
node scripts/install.mjs
```

The install script installs dependencies from the lockfile, builds every package and writes a `hansard` launcher into npm's global bin directory (the directory `npm prefix -g` prints, plus `/bin` outside Windows), which npm already keeps on your PATH. The launcher runs the CLI from your checkout, so pull and rerun the script to upgrade. It never replaces a `hansard` launcher it did not write. To uninstall, delete the launcher (`hansard` and, on Windows, `hansard.cmd`) from that directory, and delete `~/.hansard` if you want the data gone too.

To build without writing the launcher, run `node scripts/install.mjs --no-link` and call `node packages/cli/dist/index.js` instead of `hansard`.

## First run

```sh
hansard ingest
```

The first ingest copies every session file into the archive and indexes it. Later runs only read what is new: files that have not changed are skipped, and lines appended to a session since the last run are picked up without touching anything already stored. Running it twice in a row inserts nothing the second time.

Ingest prints a line for every file that had new content, a summary, and a `warning:` line for anything it skipped or could not read, with the reason. Add `--verbose` to list unchanged files too. A file that fails does not stop the run; the run finishes the other files and then exits with status 1. Run it whenever you want your history up to date, or from a scheduled task.

Output from the synthetic sessions in `tests/fixtures`:

```
$ hansard ingest
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

`hansard doctor` checks the setup and reports what is stored:

```
$ hansard doctor
...
ok    database: <home>/history.db schema version 2
ok    contents: 3 sessions, 13 events
ok    archive size: 8.9 KB (8924 bytes) in 4 files
...
```

## Commands

### `hansard search <query...>`

Full text search over every message, tool call and tool result. Each word in the query must match; there is no query syntax to learn or escape. Hits are ranked best first and show time, session id prefix, role, project and a snippet with the matches in brackets.

```
$ hansard search kestrel
2026-03-09 14:00  aaaaaaaa  user  demo  Why does the [kestrel] worker drop jobs on restart? Screenshot of the...
2026-03-09 14:00  aaaaaaaa  assistant  demo  The [kestrel] worker exits without draining its queue. Await the drain before...
```

| option | effect |
| --- | --- |
| `--project <text>` | only projects whose directory contains this text (case-insensitive) |
| `--since <when>` | on or after a date (`2026-10-01`, `2026-10-01T09:00Z`) or a duration back from now (`12h`, `7d`, `2w`) |
| `--until <when>` | before that time; a bare date includes the whole day |
| `--role <role>` | `user`, `assistant`, `tool` or `system` |
| `--sort time` | newest first instead of best match first |
| `--thinking` | include the assistant's thinking blocks |
| `--limit <n>` | number of hits (default 20) |
| `--json` | full session ids and fields as JSON |

### `hansard sessions`

Recent sessions, newest first: start time, session id prefix, source, machine, event count, project and title.

```
$ hansard sessions
2026-03-16 16:30  aaaaaaaa  claude-code  b1f70da0  3  notes  List the action items from the quarterly planning notes.
2026-03-09 14:00  aaaaaaaa  claude-code  b1f70da0  5  demo  Kestrel worker drops jobs on restart
2026-03-02 09:15  aaaaaaaa  claude-code  b1f70da0  5  demo  Shrinking the demo sqlite file
```

Takes `--project`, `--since`, `--until`, `--limit` (default 50), `--sort time|project|length` and `--json`.

### `hansard show <session_id>`

Replays one session as a transcript. The id can be any prefix that matches exactly one session; `hansard sessions --json` and `hansard search --json` print full ids. Each tool call is one line; `--expand-tools` prints its full input and output. `--thinking` includes thinking blocks and `--json` prints the session as JSON.

```
$ hansard show aaaaaaaa-0000-4000-8000-000000000002
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

### Other commands

`hansard doctor` is covered above. `hansard exclusions`, `hansard rebuild`, `hansard sources` and `hansard machine` also exist, as do `hansard ui`, `hansard watch` and `hansard import claude-ai`, which are outside v0.1 (see [ROADMAP.md](ROADMAP.md)). `hansard --help` lists them all. Every command accepts `--home <dir>`, and exits 0 on success, 1 on an error or no match, 2 on bad usage and 3 when another ingest holds the lock.

## Where your data lives

Hansard's data directory is `~/.hansard` (on Windows, `C:\Users\<you>\.hansard`). Set `HANSARD_HOME`, or pass `--home <dir>`, to use another one. It holds:

- `history.db`: the SQLite database. Its location can be changed with `dbPath` in `config.json`.
- `archive/`: Hansard's own copy of every session file (`archive/raw/claude-code/<machine id>/<project folder>/<session id>.jsonl`). Its location can be changed with `archiveRoot` in `config.json`.
- `config.json`, `exclusions.json`, `machine.json` and a `denylist.txt` for development, described below.

Hansard opens your Claude Code sessions read-only and never modifies them.

### Why Hansard keeps its own copy

Claude Code deletes old session files: by default, transcripts older than 30 days are removed at startup (the `cleanupPeriodDays` setting). An index alone would then point at files that no longer exist. So ingest first appends any new complete lines of each session file to the archive (append-only, never rewritten), then indexes the archive. Your history survives Claude Code's cleanup, and `hansard rebuild` can recreate the database from the archive at any time. The cost is disk space: the archive is about the size of your sessions directory, and `hansard doctor` reports it.

If a session file ever shrinks or stops matching what was archived, ingest leaves the archive alone and warns about that file.

### What is stored

| table | holds |
| --- | --- |
| `sessions` | one row per session: id, project directory, `started_at`, `ended_at`, `event_count`, title |
| `events` | one row per text block, thinking block or tool call, with role (`user`, `assistant`, `tool`, `system`), timestamp and text; a tool call's result is merged into its row |
| `raw_records` | every line of every session file as written, including lines Hansard does not index, so nothing is lost |
| `events_fts` | the FTS5 full text index over event text |
| `ingest_state` | how far each archive file has been read, which is what makes ingest incremental |

## Privacy

- **Local only.** No account, no server, no sync, no telemetry, no network calls.
- **Protect `~/.hansard` like the sessions it copies.** The archive and the database keep the original, unredacted text. Hansard creates the directory private on macOS and Linux and `hansard doctor` warns if it is not; on Windows it inherits your profile's permissions.
- **Excluding projects and sessions.** `hansard exclusions add --project '<glob>'` hides every session that worked in a matching directory, and `hansard exclusions add --session <id>` hides one session. Globs match the full absolute project path, for example `--project '**/demo'`, and are case-insensitive: `*` matches within a path segment, `**` matches across segments, and a trailing `/**` also matches the directory itself. Excluded sessions are hidden from search, sessions and show but stay in the archive, and `hansard exclusions remove` brings them back.
- **Redaction.** Text is scanned for common secret shapes (private keys, JWTs, bearer tokens, cloud and API keys, connection strings, password and token assignments) and replaced with markers such as `[REDACTED:anthropic]` in everything the commands print. It is best-effort pattern matching that will miss secrets of other shapes, so do not rely on it alone; exclude sensitive projects. The patterns live in `packages/core/src/redaction/patterns.ts`.
- `hansard ui` (outside v0.1) serves a local web UI on 127.0.0.1 only, behind a per-run token. See `packages/server/README.md`.

## Development

Tests, from the repository root after installing:

```sh
corepack pnpm test
```

That runs every test (vitest) against the TypeScript sources, so no build is needed first. The tests only ever use the synthetic sessions in `tests/fixtures/claude-code` and temporary directories; they never read your real home directory. With pnpm on your PATH, `pnpm test` works too, as do:

```sh
pnpm typecheck
pnpm hygiene          # personal data scan of every tracked file
pnpm hygiene:history  # the same over all of git history, before publishing
pnpm pack:check       # npm tarball contents, after a build
```

### Commit checks

Hooks run through lefthook, installed by `pnpm install`. If your git config sets a global `core.hooksPath`, point this repository at its own hooks first with `git config core.hooksPath .git/hooks`, then run `corepack pnpm exec lefthook install`. Every commit runs:

- **gitleaks** on the staged changes. Install it first (`winget install Gitleaks.Gitleaks`, `brew install gitleaks`, or a release binary).
- **hygiene** on the staged lines. It rejects absolute home paths, email addresses, em and en dashes, any entry in your denylist, any path into a Claude Code projects directory, and any session id that exists on your machine (collected from `~/.claude/projects` and the Hansard archive). It fails closed: a missing denylist or an unreadable session directory blocks the commit. Copy `denylist.example.txt` to `~/.hansard/denylist.txt` and add your own name, usernames, hostnames and employer.
- the commit message format check: `type(scope): description`, subject at most 72 characters.

Test data goes in `tests/fixtures/claude-code`, written by hand with invented content and the placeholder user `alice`. Never copy a real session into the repository.

To add a source other than Claude Code, see [ADAPTERS.md](ADAPTERS.md).

## License

MIT

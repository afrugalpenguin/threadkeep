# Your data

For anyone who wants to know where Hansard writes, how much space it takes, or how to move or reset it.

## Where does my data go?

Into Hansard's data directory, `~/.hansard` (on Windows, `C:\Users\<you>\.hansard`). Nothing is written inside the repository. Set `HANSARD_HOME`, or pass `--home <dir>` to any command, to use another directory. It holds:

- `history.db`: the SQLite database. Its location can be changed with `dbPath` in `config.json`.
- `archive/`: Hansard's own copy of every session file (`archive/raw/claude-code/<machine id>/<project folder>/<session id>.jsonl`). Its location can be changed with `archiveRoot` in `config.json`.
- `config.json`: `dbPath`, `archiveRoot` and the source roots (`sources.claude-code.root`, default `~/.claude/projects`). In paths, `<home>` means the data directory and `~` your home directory.
- `exclusions.json`: the projects and sessions you have hidden (see [privacy.md](privacy.md)).
- `machine.json`: this machine's id and optional label.
- `denylist.txt`: only needed for development (see [development.md](development.md)).

The first command you run creates the directory and the three JSON files. Existing `config.json` files are never rewritten.

Hansard opens your Claude Code sessions read-only and never modifies them.

## Why does Hansard keep its own copy?

Claude Code deletes old session files: by default, transcripts older than 30 days are removed at startup (the `cleanupPeriodDays` setting). An index alone would then point at files that no longer exist, so Hansard does not read the sessions in place. Ingest first appends any new complete lines of each session file to the archive (append-only, never rewritten), then indexes the archive. Your history survives Claude Code's cleanup, and `hansard rebuild` can recreate the database from the archive at any time.

If a session file ever shrinks or stops matching what was archived, ingest leaves the archive alone and warns about that file.

## How big does it get?

The archive is about the size of your Claude Code sessions directory, since it is a copy of it. The database is larger than the archive: it keeps every raw line, the extracted text and a full text index. As one real data point, 48 sessions made a 261 MB archive and a 608 MB database. `hansard doctor` reports the archive size, file count, session count and event count.

## How do I move it?

Set `HANSARD_HOME` to the new directory in your shell profile and move the old directory's contents there, or start fresh and run `hansard ingest` again. To keep the data directory but put only the database or archive elsewhere, change `dbPath` or `archiveRoot` in `config.json`.

## How do I reset it?

- **Rebuild the database, keep the history:** run `hansard rebuild`. It recreates sessions and events from the archive alone, without reading Claude Code's files, so sessions Claude Code has already deleted come back too. It applies the current parsers and redaction patterns, so run it after upgrading. Decisions, links and import records (used by the outside-v0.1 web UI and claude.ai import) are kept.
- **Start again from what Claude Code still has:** delete `~/.hansard` and run `hansard ingest`. Anything Claude Code has already pruned is gone for good, because the archive was its only copy.
- **Hide something without deleting it:** use `hansard exclusions` (see [usage.md](usage.md#other-commands)).

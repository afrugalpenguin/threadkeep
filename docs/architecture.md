# Architecture

For contributors and the curious: read this before changing how ingest, storage or search work.

## How is the repository laid out?

A pnpm monorepo with three packages:

| package | holds |
| --- | --- |
| `packages/core` (`@hansard/core`) | config and data directory, source adapters, archive mirror, ingest, the SQLite store and migrations, redaction, exclusions and queries |
| `packages/cli` (`hansard`) | the `hansard` command: argument parsing and output for each command, nothing else |
| `packages/server` (`@hansard/server`) | the local web UI behind `hansard ui` (outside v0.1) |

`scripts/` holds the installer, the privacy hygiene check, the commit message check and packaging checks. `tests/` holds repository level tests and the synthetic fixtures; each package also has its own `test/` folder. To add a source other than Claude Code, see [ADAPTERS.md](../ADAPTERS.md).

## What happens during an ingest?

1. **Lock.** Ingest, rebuild and import take a lock in the data directory so two runs can never double append to the archive. A second run waits up to `--wait` and then exits with code 3.
2. **Mirror.** Each live adapter (today, `claude-code`) walks its source root, `~/.claude/projects` by default, and appends any new complete lines of each session file to `<archive>/raw/claude-code/<machine id>/<project folder>/<session id>.jsonl`. Partial last lines wait for the next run. Subagent transcripts are ignored. If a source file shrinks or no longer matches its archived prefix, the archive is left alone and a warning names the file.
3. **Ingest the archive.** For each archive file, the byte offset stored in `ingest_state` says how far it has been read. A file whose size equals that offset is `unchanged`; one shorter than its offset, or unreadable, is `skipped` with a warning. Otherwise only the complete lines after the offset are parsed, and all of that file's writes plus the new offset are committed in one transaction, so a crash never leaves a half ingested file.
4. **Record per file outcomes.** Every file ends as `ingested`, `unchanged`, `skipped` (with a reason) or `failed`. A failure is recorded and the run moves on; the command exits 1 at the end if any file failed.

Idempotency comes from three places: the stored byte offsets, the unique `(source, location, byte_offset)` key on raw records, and event ids derived from the source data (`stableId` in `packages/core/src/ids.ts`), so a repeated insert is a no-op.

## What is stored?

The schema as shipped (migrations in `packages/core/src/store/migrations`):

| table | holds |
| --- | --- |
| `sessions` | one row per session: id, project directory, `started_at`, `ended_at`, `event_count`, title, and an `excluded` flag |
| `events` | one row per text block, thinking block or tool call, with role (`user`, `assistant`, `tool`, `system`), timestamp and text; a tool call's result is merged into its row |
| `raw_records` | every line of every session file as written, including lines Hansard does not index, so nothing is lost; keyed by source, archive location and byte offset |
| `events_fts` | the FTS5 full text index over event text |
| `ingest_state` | how far each archive file has been read, which is what makes ingest incremental |

`imports`, `links` and `decisions` also exist for the claude.ai importer and the web UI, which are outside v0.1. The mapping from the names in the original v0.1 brief to these tables is in [roadmap.md](roadmap.md#schema-notes).

### Why is search over redacted text?

Each event stores its text twice: `content` as written and `content_redacted` with secrets replaced by markers such as `[REDACTED:anthropic]` (tool inputs and outputs likewise). `events_fts` indexes only `content_redacted` and the tool name, using the `unicode61` tokenizer with diacritics removed, and every command prints only redacted text. So a secret can neither be printed nor be found by searching for it. The patterns are in `packages/core/src/redaction/patterns.ts`; see [privacy.md](privacy.md) for their limits.

## Why TypeScript?

The repository started in TypeScript and the v0.1 brief said to keep the existing language. It also suits the job: Node runs everywhere Claude Code does, `better-sqlite3` gives synchronous SQLite with FTS5 built in, and one language covers the CLI, the core library and the web UI.

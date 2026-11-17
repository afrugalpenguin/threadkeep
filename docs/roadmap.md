# Roadmap

For anyone wondering whether a feature exists or is planned: read this before asking for one or building it.

Threadkeep v0.1 is the command line for your Claude history: `ingest` for Claude Code sessions, `import claude-ai` for claude.ai export zips, then `search`, `sessions`, `show` and `doctor` over both. Everything else lives here until it is picked up.

## What is built but outside v0.1?

These already exist in the code and keep their tests. They are not extended until v0.1 has been in daily use for a while.

- `threadkeep ui`: the local web UI in `packages/server` (sessions, search, replay, decisions).
- `threadkeep watch`: ingest whenever source files change.
- Decisions: the `decisions` table and the web UI views that read and update it. Nothing writes proposed decisions yet.
- Exclusions, redaction and machine labels. v0.1 commands use them, but they are not extended.
- `threadkeep rebuild`: rebuild the database from the archive.

## What is not built yet?

- Hooks: ingest a session from a Claude Code hook as it is written. `<home>/hooks.log` is reserved for this.
- MCP server so a running agent can search its own history. `threadkeep doctor` warns that it is not built.
- Slash commands and a Claude Code plugin wrapper.
- A TUI.
- Adapters for other tools (GitHub Copilot and others). See [ADAPTERS.md](../ADAPTERS.md) for the adapter interface.
- The parts of a claude.ai export that have no adapter yet (projects, memories).
- Extracting decisions from sessions automatically.
- Publishing to npm. `pnpm pack:check` exists, but nothing is published.

## Schema notes

The v0.1 brief described `sessions` and `messages` tables. The schema that shipped is equivalent and is documented in [architecture.md](architecture.md#what-is-stored) rather than renamed:

| brief | schema |
| --- | --- |
| `messages` | `events`: one row per text block, thinking block or tool call (with its result merged in) |
| `messages.raw_json` | `raw_records.raw`, linked by `events.raw_id` |
| `messages.seq` | `raw_records.byte_offset`, plus `events.timestamp` |
| `sessions.last_message_at` | `sessions.ended_at` |
| `sessions.message_count` | `sessions.event_count` |
| `sessions.path` | the archive path in `ingest_state.key` |
| size and mtime per file | byte offset and ingest time per file in `ingest_state` |

Renaming would need a migration for no change in behaviour, so it is deferred indefinitely.

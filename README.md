# Hansard

Hansard keeps a searchable, local archive of your AI conversation history. It reads Claude Code sessions as they are written and claude.ai data exports, stores them in SQLite with redaction and exclusions applied, and gives you a command line and a local web UI to search and replay them.

## Install

Hansard is built from source for now. It needs Node 22 or newer and pnpm.

```sh
pnpm install
pnpm build
node packages/cli/dist/index.js --help
```

To get a `hansard` command, run `pnpm link --global` inside `packages/cli`, or call the built file directly as above. The examples below use `hansard`.

## Commands

| command | what it does |
| --- | --- |
| `hansard ingest [path]` | mirror local sources into the archive and ingest them |
| `hansard import claude-ai <path...>` | import claude.ai export zips, a directory of them or a manifest |
| `hansard sessions` | list sessions (`--source`, `--project`, `--since`, `--machine`, `--sort`, `--limit`, `--json`) |
| `hansard search <query...>` | full text search (`--source`, `--project`, `--since`, `--role`, `--machine`, `--sort`, `--thinking`, `--limit`, `--json`) |
| `hansard show <session_id>` | print a session (`--expand-tools`, `--thinking`, `--json`) |
| `hansard ui` | serve the local web UI (`--port`, `--open`) |
| `hansard exclusions list\|add\|remove` | manage exclusions (`--project <glob>` or `--session <id>`) |
| `hansard sources` | list adapters and whether their location was found |
| `hansard rebuild` | rebuild the database from the archive |
| `hansard doctor` | check the setup |
| `hansard watch` | ingest whenever sources change |
| `hansard machine show\|set-label <label>` | show or label this machine |

Every command accepts `--home <dir>`. The default is `HANSARD_HOME`, else `~/.hansard`.

Example output, produced from the synthetic demo data (`pnpm fixtures <dir>` writes it):

```
$ hansard sessions
2026-01-02 10:00  22222222  claude-code  28f5c9f8  3  demo  Demo conversation 2
2026-01-01 10:00  11111111  claude-code  28f5c9f8  5  demo  Demo conversation 1
2026-01-01 00:00  c0000000  claude-ai  28f5c9f8  5  -  Demo conversation 1
2026-01-01 00:00  c0000000  claude-ai  28f5c9f8  5  -  Demo conversation 2

$ hansard search deploy
2026-01-01 10:00  11111111  user  demo  For the [deploy] step my token is [REDACTED:anthropic] so keep it...
2026-01-01 00:00  c0000000  user  -  For the [deploy] step my token is [REDACTED:anthropic] so keep it...

$ hansard sources
claude-code  live  found yes  ~/.claude/projects
claude-ai  import  found yes  <archive>/raw/claude-ai
```

## Privacy

- **Local only.** Everything stays on your machine. There is no account, no server and no sync service.
- **No telemetry and no network calls.** Hansard never contacts the internet. `hansard ui` listens on 127.0.0.1 only and requires a random per-run token.
- **What is stored where.** By default everything is under `~/.hansard`:
  - `history.db`: the SQLite database
  - `archive/`: byte-for-byte copies of the source files (Claude Code session files and imported claude.ai zips)
  - `config.json`: database and archive paths and source roots
  - `exclusions.json`: your exclusions
  - `machine.json`: this machine's id and label
  - `hooks.log`: reserved for hook runs; nothing writes it yet

  Hansard reads your Claude Code sessions from `~/.claude/projects` and never modifies them. The archive and the database keep the original, unredacted text, so protect `~/.hansard` like the sources it copies.
- **Excluding projects and sessions.** `hansard exclusions add --project '<glob>'` hides every session that worked in a matching directory. `hansard exclusions add --session <id>` hides one session. Globs are case-insensitive: `*` matches within a path segment, `**` matches across segments, and a trailing `/**` also matches the directory itself. Excluded sessions are hidden from every read path (search, sessions, show, the web UI) but stay in the archive, and `hansard exclusions remove` brings them back.
- **Redaction.** Text is scanned for common secret shapes (private keys, JWTs, bearer tokens, cloud and API keys, connection strings, password and token assignments) and replaced with markers such as `[REDACTED:anthropic]`. Search, listings, `show` and the web UI only read the redacted text. Redaction is best-effort pattern matching: it will miss secrets that do not look like the patterns, so do not rely on it as your only protection. Add exclusions for sensitive projects. The patterns live in `packages/core/src/redaction/patterns.ts`.

## Upgrading

Run `hansard rebuild` once after upgrading so earlier sessions pick up the `system` role for lines the tool generated itself.

## Adding a source

See [ADAPTERS.md](ADAPTERS.md).

## Development

```sh
pnpm test         # unit and integration tests
pnpm typecheck
pnpm hygiene      # personal data scan of tracked files
pnpm fixtures <dir>   # synthetic demo data, after pnpm build; dir must be empty and outside the repo
```

## License

MIT

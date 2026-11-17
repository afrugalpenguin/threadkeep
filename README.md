# Threadkeep

Searchable, replayable history of your Claude Code sessions, kept outside the repo.

- Claude Code prunes sessions older than 30 days, and Threadkeep keeps a copy.
- You forget what you did last week, and why. Threadkeep finds it again.
- grep over raw JSONL doesn't cut it. Threadkeep gives you ranked search, filters and a readable replay.

## Quick start

```sh
# 1. Check for Node 22 or 24, which bundle corepack (on Node 25+, npm install -g pnpm first)
node --version
# 2. Clone the repository
git clone https://github.com/afrugalpenguin/threadkeep.git; cd threadkeep
# 3. Install, build and put threadkeep on your PATH
node scripts/install.mjs
# 4. Copy and index your sessions; rerun any time, it only reads what is new
threadkeep ingest
# 5. Search them; it worked if you get hits shaped like the block below
threadkeep search "sqlite"
```

```
2026-03-02 09:15  aaaaaaaa  user  demo  How do I shrink the [sqlite] file after deleting the migration backlog?
```

## Commands

| command | what it does | example |
| --- | --- | --- |
| `threadkeep ingest` | copy new session data into the archive and index it | `threadkeep ingest` |
| `threadkeep search <words>` | full text search; every word must match | `threadkeep search migration --project api --since 7d` |
| `threadkeep sessions` | list sessions, newest first | `threadkeep sessions --since 2026-10-12 --until 2026-10-18` |
| `threadkeep show <id>` | replay one session; any unique id prefix works | `threadkeep show 3f2a --expand-tools` |

`threadkeep doctor` checks your setup and reports session count, event count and archive size.

## Where your data lives

Everything lives in `~/.threadkeep`, never in the repo. Set `THREADKEEP_HOME` to keep it elsewhere.

## Docs

- [Usage](docs/usage.md): every flag, date ranges, exit codes
- [Your data](docs/data.md) and [privacy](docs/privacy.md): location, size, resetting, redaction, commit checks
- [Architecture](docs/architecture.md) and [development](docs/development.md): layout, schema, tests, hooks
- [Roadmap](docs/roadmap.md): what is not in v0.1

Licence: [MIT](LICENSE).

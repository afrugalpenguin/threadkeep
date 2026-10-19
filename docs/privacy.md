# Privacy

For anyone who wants to know what Hansard does with their sessions, and for contributors whose commit was blocked by the privacy check.

## Does anything leave my machine?

No. There is no account, no server, no sync, no telemetry and no network access. `hansard ui` (outside v0.1) serves a local web UI on 127.0.0.1 only, behind a per-run token; see `packages/server/README.md`.

## What should I protect?

Protect `~/.hansard` like the sessions it copies. The archive and the database keep the original, unredacted text. Hansard creates the directory private on macOS and Linux, and `hansard doctor` warns (with a `chmod 700` hint) if it is not; on Windows it inherits your profile's permissions.

## What gets redacted?

Text is scanned for common secret shapes (private keys, JWTs, bearer tokens, cloud and API keys, connection strings, password and token assignments) and replaced with markers such as `[REDACTED:anthropic]` in everything the commands print. Search only indexes the redacted text (see [architecture.md](architecture.md#why-is-search-over-redacted-text)). It is best-effort pattern matching that will miss secrets of other shapes, so do not rely on it alone; exclude sensitive projects. The patterns live in `packages/core/src/redaction/patterns.ts`.

## How do I keep a project out of results?

- `hansard exclusions add --project '<glob>'` hides every session that worked in a matching directory.
- `hansard exclusions add --session <id>` hides one session.

Globs match the full absolute project path, for example `--project '**/demo'`, and are case-insensitive: `*` matches within a path segment, `**` matches across segments, and a trailing `/**` also matches the directory itself. Excluded sessions are hidden from search, sessions and show but stay in the archive, and `hansard exclusions remove` brings them back. `hansard exclusions list` shows what is excluded.

## How does the repository stay free of real data?

This section is for contributors. Three things keep personal data out of the repository:

- **Synthetic fixtures only.** Test data lives in `tests/fixtures/claude-code`, written by hand to look like real Claude Code JSONL but with invented content and the placeholder user `alice`. Never copy a real session into the repository. The tests only ever use these fixtures and temporary directories; they never read your real home directory.
- **gitleaks** scans staged changes on every commit, and CI scans the full history.
- **The hygiene check** (`scripts/check-hygiene.mjs`, rules in `scripts/hygiene-rules.mjs`) scans the staged lines on every commit, and CI scans the full history.

### What does the hygiene check block?

| rule | blocks |
| --- | --- |
| `home-path` | absolute home paths such as `/Users/<name>/`, `/home/<name>/` or `C:\Users\<name>\`, except the placeholder user `alice` |
| `email` | email addresses, except `example.com`, `example.org` and GitHub noreply addresses |
| `dash` | em and en dashes (use a hyphen) |
| `denylist-entry-N` | any entry in your denylist: your name, usernames, hostnames, employer |
| `claude-projects-path` | any path that goes into a Claude Code projects folder, with either slash |
| `real-session-id` | any session id that exists on your machine, in any case |

Findings print the file, line number and rule name only, never the matched text, so they are safe in public CI logs. File names that contain a real session id are printed as `<session-id>`.

### Why is the bare `~/.claude/projects` allowed?

A path that continues past that folder into a project folder names one of your real projects (Claude Code names each folder after the project's directory), so it is blocked. The bare folder name is not personal: the docs and the code have to say that Hansard reads `~/.claude/projects`. So the rule only fires when the path continues into a project folder, that is when `projects/` is followed by a letter, digit or `-`. A placeholder such as `~/.claude/projects/<project>/` and a regex are allowed.

### Where do the real session ids come from?

The check collects the name of every uuid-named file and folder under `~/.claude/projects` and under the Hansard archive (read from `config.json`, honouring `HANSARD_HOME`). Set `HANSARD_SESSION_ROOTS` to a path-delimited list of folders to scan instead. A folder that does not exist is skipped.

### What if the hook fails closed?

The check blocks the commit, rather than letting it through unchecked, when it cannot do its job:

- `hygiene: denylist not found ... Failing closed.` Copy `denylist.example.txt` to `~/.hansard/denylist.txt` and replace its entries with your own (one per line, matched case-insensitively as a substring; `#` lines are comments). `HANSARD_DENYLIST` points at another file.
- `hygiene: could not read the session roots ... Failing closed.` A session folder exists but cannot be read, for example a file where a folder should be, or a permissions problem. Fix the folder, or point `HANSARD_SESSION_ROOTS` at the folders that hold your sessions.
- A real finding: remove the offending text from the staged change. Never bypass the hook with `--no-verify`.

To check everything before publishing, run `pnpm hygiene` (every tracked file) and `pnpm hygiene:history` (every line ever added in git history).

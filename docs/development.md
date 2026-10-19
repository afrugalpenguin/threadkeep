# Development

For contributors: read this before your first change to set up the hooks, run the tests and avoid the build quirk.

## How do I set up a development checkout?

You need Node 22 or newer, git and pnpm. Node 22 and 24 ship pnpm through corepack, so `corepack pnpm --version` working is enough; otherwise, and on Node 25 and later which no longer ship corepack, run `corepack enable` (where corepack exists) or `npm install -g pnpm`. Then:

```sh
git clone https://github.com/afrugalpenguin/hansard.git
cd hansard
git config core.hooksPath .git/hooks   # only if your global git config sets core.hooksPath
corepack pnpm install
```

`node scripts/install.mjs` does the install and the build in one go and writes the `hansard` launcher (see [usage.md](usage.md#how-do-i-install-upgrade-or-remove-it)); `--no-link` skips the launcher.

## Which commands are there?

From the repository root, with `corepack pnpm <script>` (or plain `pnpm <script>` with pnpm on your PATH):

| script | does |
| --- | --- |
| `test` | every test (vitest) against the TypeScript sources, so no build is needed first |
| `typecheck` | `tsc` over every package, the web client and the tests |
| `build` | builds every package; see the quirk below |
| `hygiene` | personal data scan of every tracked file |
| `hygiene:history` | the same over all of git history, before publishing |
| `pack:check` | npm tarball contents, after a build |
| `fixtures <dir>` | write synthetic demo data for every adapter into an empty directory, after a build |

## How do I run the tests?

```sh
corepack pnpm test
```

That runs every test file in the repository. The tests only ever use the synthetic sessions in `tests/fixtures/claude-code` and temporary directories; they never read your real home directory. Coverage that v0.1 relies on: the parser (`packages/core/test/fixture-parser.test.ts`), idempotency and per-file ingest outcomes (`packages/core/test/ingest-log.test.ts`), and search, sessions, show and doctor from the command line (`packages/cli/test/fixtures.test.ts`).

## Why does `pnpm build` fail from the root?

The root `build` script runs `pnpm -r build`, which calls `pnpm` by name. If pnpm is only available through corepack, `corepack pnpm build` starts but the nested `pnpm` is not on your PATH, so it fails. Either run `corepack pnpm -r build` directly, run `corepack enable` (or `npm install -g pnpm`) so `pnpm` is on your PATH, or use `node scripts/install.mjs --no-link`, which calls pnpm the right way.

## How are the commit hooks set up?

Hooks run through lefthook. `pnpm install` runs lefthook's install step, which writes the hooks into whatever `core.hooksPath` points at. If your global git config sets `core.hooksPath`, point this repository at its own hooks first with `git config core.hooksPath .git/hooks`, otherwise lefthook overwrites your global hooks; then run `corepack pnpm exec lefthook install`. Every commit runs:

- **gitleaks** on the staged changes. Install it first (`winget install Gitleaks.Gitleaks`, `brew install gitleaks`, or a release binary).
- **hygiene** on the staged lines. It rejects absolute home paths, email addresses, em and en dashes, any entry in your denylist, any path into a Claude Code projects directory, and any session id that exists on your machine (collected from `~/.claude/projects` and the Hansard archive). It fails closed: a missing denylist or an unreadable session directory blocks the commit. Copy `denylist.example.txt` to `~/.hansard/denylist.txt` and add your own name, usernames, hostnames and employer. Details and fixes are in [privacy.md](privacy.md#what-does-the-hygiene-check-block).
- the commit message check (`scripts/check-commit-msg.mjs`): `type(scope): description` with a type from `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf` and `style`, subject at most 72 characters, and no em or en dashes anywhere in the message.

CI runs typecheck, build, `pack:check` and the tests on Node 22, and gitleaks and the hygiene check over the full history.

## What test data may I add?

Test data goes in `tests/fixtures/claude-code`, written by hand with invented content and the placeholder user `alice`. Never copy a real session into the repository, even trimmed or edited. `.gitignore` ignores `*.jsonl` everywhere except under `tests/fixtures/claude-code`, and the hygiene check rejects real session ids and paths into your projects folder.

To add a source other than Claude Code, see [ADAPTERS.md](../ADAPTERS.md).

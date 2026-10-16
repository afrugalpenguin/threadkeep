# Adding an adapter

An adapter teaches Hansard to read one source of conversation history.

## The interface

`SourceAdapter` lives in `packages/core/src/adapters/types.ts`.

- `id`: stable key. It becomes the `source` column and the `ingest_state` adapter name, so never change it.
- `displayName`: human label.
- `kind`: `live` reads files that change in place (appended chunks). `import` reads immutable archive files such as zips.
- `describe()`: what it reads, the default local location and the archive layout.
- `discover(ctx)`: the locations to check and whether each was found. This feeds `hansard sources`.
- `mirror(ctx, opts?)`: live only. Copies new bytes from the local source into the archive.
- `archiveFileFor(ctx, localPath)`: live only. The archive file a local path mirrors to, or null if the adapter does not own it.
- `archiveFiles(ctx, onWarning?)`: every archive file the adapter owns. `rebuild` replays these.
- `skipReason(file)`: optional. A reason to skip a file (for example a sync conflict copy), or null.
- `parse(file, chunk, ctx)`: required on every adapter. Live adapters turn a chunk of lines into records, events, tool result patches and session updates; import adapters stub it with an empty result.
- `parseArchive(file, ctx)`: import only. Yields `ParseResult`s from an archive file, streaming where it can.
- `fixtures`: a `FixtureGenerator` with `generate` (small test trees) and `sample` (the fixed demo set used by `pnpm fixtures`).

## Register it

Add the adapter to the `adapters` array in `packages/core/src/adapters/registry.ts`. A live adapter also needs a default root in `DEFAULT_CONFIG` (`packages/core/src/config.ts`); existing `config.json` files are not updated, so users add the root by hand. An import adapter currently needs its own import entry point modelled on `import-claude-ai.ts`, plus a branch for it in `packages/cli/src/commands/simple.ts`, because `hansard import` only accepts `claude-ai` today.

## State and schema

The adapter owns its `ingest_state` keys. The key is `ArchiveFile.relPath`, relative to the archive root, so choose a layout like `raw/<id>/...`. Events and sessions carry a plain text `source` column, so a new adapter needs no migration. Event ids must be stable (see `stableId` in `ids.ts`) so a second ingest changes nothing.

## Checklist

1. Fixtures: a builder module in the adapter folder, `fixtures.generate` and a `fixtures.sample`. Synthetic content only (user "alice", project "/home/alice/projects/demo"). The sample takes its fake secret from the caller.
2. Parser tests: normal turns, tool use and results, thinking, malformed lines, attachments.
3. Double-ingest test: ingesting twice adds nothing; a rebuild gives the same rows.
4. Redaction coverage test: a planted secret never shows up in search, sessions or show output.
5. Exclusion test: an excluded project or session disappears from every read path.
6. `describe()` entry filled in accurately.
7. `hansard sources` lists the adapter and reports `found` correctly.
8. Docs: mention the source in the README and add a note here if it has quirks.

## Existing adapters

| id | kind | verified against real data |
| --- | --- | --- |
| `claude-code` | live | yes |
| `claude-ai` | import | yes |

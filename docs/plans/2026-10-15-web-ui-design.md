# Web UI design

Date: 2026-10-15. Package: `packages/server`. Branch: `feat/web-ui`.

A local, read-mostly web UI over the Hansard store: a session list, search with the CLI filters, a replay view with a turn scrubber and a files-touched panel, and a decisions list where confirm and dismiss are the only writes.

## Architecture

- `packages/server` holds a Fastify app and a Preact client under `src/client/`. esbuild bundles the client to `dist/public/app.js`; the page is one static `index.html` plus one stylesheet. No CDN, no runtime network access.
- The package exports `startServer(ctx, { port })` and depends only on `@hansard/core`.
- The CLI gains `hansard ui [--port 4477] [--open]`, which imports the server package lazily so other commands do not pay its startup cost.

## Safety

- Binds `127.0.0.1` only. There is no option to bind wider.
- Rejects any request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding.
- Generates a random token per run and embeds it in the page. The only write route requires it in an `x-hansard-token` header, so a cross-site form post cannot change decisions.
- Sends no CORS headers.
- All reads go through core query functions, so redaction and exclusions are enforced in one place. The server never builds SQL.
- Request logs record method, route and status only, never query text. Startup prints the URL and the data home in display form.

## API

All routes live under `/api`. Input is validated with Fastify JSON schemas.

| Route | Core function |
| --- | --- |
| `GET /api/sessions?source&project&since&machine&sort&limit&offset` | `listSessions` |
| `GET /api/search?q&source&project&since&role&machine&sort&thinking&limit` | `search` |
| `GET /api/sessions/:id?thinking&expandTools` | `getSession` |
| `GET /api/facets` | `listFacets(ctx, db)` |
| `GET /api/decisions?status&session` | `listDecisions` |
| `POST /api/decisions/:id/status` with `{ "status": "confirmed" \| "dismissed" }` | `setDecisionStatus` |

Errors: `UsageError` maps to 400, `NotFoundError` to 404, `AmbiguousError` to 409, schema validation failures to 400 with `invalid request`, other 4xx framework errors to their status with `bad request`, anything else to 500 with the body `internal error`. Detail goes to the terminal log through the safe message helper.

## Core additions

- `listDecisions(db, { status, session })`, joined to `sessions` with `excluded = 0`.
- `setDecisionStatus(db, id, status)`, allowing only `proposed` to `confirmed` or `dismissed`.
- `offset` on `listSessions`.
- `listFacets(ctx, db)`: distinct sources, machines with labels, and projects over non-excluded sessions.

These are shared with the MCP server later.

## Views

Hash routing: `#/sessions`, `#/search?q=...`, `#/session/<id>?event=<id>`, `#/decisions`.

- Sessions: filter bar (source, project, machine, since), sort (time, project, source, length), table of started, title, project, source, machine, events. Pages of 50 with "Load more".
- Search: query box plus the session filters, role, include thinking, and rank or time sort. Hits are grouped by session with highlighted snippets. A hit opens the replay at that event.
- Replay: header with session metadata. A range slider over turns (a turn starts at a user message); `j` and `k` step through turns. Text renders as preformatted plain text with no Markdown or HTML, so archived content cannot inject markup. Tool events collapse to name and summary and expand to redacted input and output. Thinking is hidden behind a toggle. The side panel lists files touched up to the current turn with counts, linking to the first turn that touched each file, and the session's decisions.
- Decisions: filter by status, Confirm and Dismiss on proposed items, link to the session. Empty state: "no decisions recorded yet".
- Hand-written CSS following the system light or dark preference, usable at narrow widths.

## Testing

All tests use synthetic fixtures in a temp dir per test.

- Core: decision listing and transitions, session offset, facets, exclusion coverage.
- Server via `fastify.inject()`: redacted content only (a planted secret never appears in any response), excluded sessions never appear through any route, foreign `Host` gets 403, missing or wrong token gets 403, error mapping, 500 bodies say `internal error` only, logs never contain query text.
- Client logic in plain modules with unit tests: turn grouping, files touched up to a turn, snippet highlight segments, URL to filter state.

## Packaging

- `files` field: `dist`, README, LICENSE.
- `pnpm build` runs `tsc` then the esbuild client bundle. Root typecheck and CI include the package.
- New dependencies: `fastify` (runtime), `preact` and `esbuild` (dev). The client is bundled by esbuild, so preact is not needed at runtime.

## Implementation notes

Where the build differs from the plan above, and why:

- Core rejects a `limit` or `offset` that is not a non-negative integer with `UsageError`, so no caller can reach SQLite with `-1` (unlimited) or a fraction. Decision writes take the write lock up front and check that exactly one row changed.
- Every response carries the security headers, including malformed URLs (`frameworkErrors`) and unknown routes (a custom 404 that does not echo the URL). Body validation rejects unknown fields and array-wrapped values, and `text/plain` posts get 415.
- Error bodies never echo request input. `UsageError` messages are fixed guidance text (for example an invalid `since` value reports how to write one, not the value given), validation failures return `invalid request`, and other client errors return `bad request`.
- `createApp` refuses a token that is not lowercase hex, since it is embedded in the page unescaped.
- Claude Code lines that the human did not type (`isMeta`, compaction summaries, local command and bash output, task notifications, interrupt notices, IDE context, hook output and system reminders) are stored with role `system`, so they no longer start replay turns, become titles or match `--role user`. Replay shows them collapsed. Rows ingested before this change keep role `user` until `hansard rebuild` is run. After upgrading, run `hansard rebuild` once so sessions ingested earlier pick up the system role.
- The replay links search hits on thinking events with thinking shown, and filter text boxes keep a local draft so a re-render cannot discard typing.

## Out of scope

- Browser component tests.
- Any remote or multi-user access.
- Editing anything other than decision status.

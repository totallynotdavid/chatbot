# Development

This covers the checks, what CI runs, where versions are pinned, how the tests
are laid out, and the conventions a change follows. Where a change belongs is in
[Architecture](../architecture.md#where-a-change-belongs).

## Checks

Run from the repository root unless a directory is named.

| Command                               | What it catches                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `bun test`                            | every test file in the repository: backend, core, frontend                                                           |
| `bunx tsc --noEmit` in each workspace | type errors. Run it in `apps/backend`, `apps/notifier` and each of `packages/{core,intelligence,logger,types,utils}` |
| `bun run check` in `apps/frontend`    | svelte-check: types and Svelte errors in the dashboard                                                               |
| `bunx biome format`                   | formatting of code and JSON. `bun run format` writes the fixes                                                       |
| `bun run format:md`                   | formatting of Markdown and YAML, with prettier. It writes the fixes                                                  |
| `bun run build`                       | the production frontend build                                                                                        |

`bun run format` runs `biome format --write`. It does not lint.
`bunx biome lint` reports errors on the current tree and exits 1, and CI does
not run it.

There is no root script for typechecking, linting or a single test file.
`apps/backend` has `bun run test:llm`, which runs one file against the mock LLM
provider. It does not call a model.

## What CI runs

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml), on every pull request
and push to `master`:

| Job                       | Runs                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `format`                  | `biome format`                                                                      |
| `typecheck (<workspace>)` | `bunx tsc --noEmit` per workspace, `bun run check` for the frontend                 |
| `test`                    | `bun run test` in `apps/backend`, `bun test` in `packages/core` and `apps/frontend` |
| `build`                   | `bun run build`                                                                     |

[`codeql.yml`](../.github/workflows/codeql.yml) adds `analyze (actions)` and
`analyze (javascript-typescript)`. All thirteen are required to merge into
`master`, which also requires linear history and signed commits and refuses
force pushes.

Every job installs with `bun install --frozen-lockfile`. A `package.json` change
without its `bun.lock` update fails CI.

The `typecheck` matrix and the `test` job name their workspaces by hand. A new
workspace is neither typechecked nor tested in CI until it is added to both.

## Where the pins live

| Pin                                  | File                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| bun, biome, cloudflared              | [`mise.toml`](../mise.toml), resolved in `mise.lock`      |
| npm dependencies                     | `bun.lock`, installed with `--frozen-lockfile`            |
| transitive versions forced for fixes | `overrides` in the root [`package.json`](../package.json) |
| GitHub Actions                       | the `uses:` lines in `.github/workflows/`                 |

`mise install` installs the pinned tools. Dependabot
([`dependabot.yml`](../.github/dependabot.yml)) updates the bun dependencies
daily and the actions weekly. It does not update `mise.toml`; the weekly
[`mise-outdated.yml`](../.github/workflows/mise-outdated.yml) workflow runs
`mise outdated --local --bump --json` and keeps one issue with the stale pins.

## How the tests are laid out

All tests use `bun:test`.

```text
apps/backend/tests/            the backend suite, one file per behavior
apps/backend/tests/helpers/    test databases, fixtures, child processes
apps/backend/tests/setup.ts    preloaded before any test file
packages/core/tests/           transitions, eligibility, validation
*.test.ts beside the code      apps/frontend/src/lib, packages/core/src,
                               apps/backend/src/domains/notifications
```

`setup.ts` is preloaded by both the root [`bunfig.toml`](../bunfig.toml) and
[`apps/backend/bunfig.toml`](../apps/backend/bunfig.toml). It points `DB_PATH`,
`UPLOAD_DIR` and `PRIVATE_DIR` at a temporary directory, sets `NODE_ENV=test` so
sends go to the mocked Cloud API, and sets a test `WHATSAPP_APP_SECRET`. A test
never touches the development database.

Some backend tests boot the real server or open the database from several
processes (`boot-safety`, `concurrent-startup`). Some read frontend files
(`webhook-proxy`, `lima-date-contract`).

`packages/core/tests/` is not typechecked: core's `tsconfig.json` includes `src`
only.

The tests that hold the architecture's boundaries are listed in
[Architecture](../architecture.md#tests-that-enforce-structure).

## Conventions

These are what the code does today. `tenant-scope-guard.test.ts` checks the
first.

- **Tenant scope.** A read function takes `tenantId: string | null` and filters
  with `tenantPredicate`, not a hand-built `if (tenantId)` branch, from
  [`db/query.ts`](../apps/backend/src/db/query.ts). A write takes the tenant
  from `activeTenantId(c)`. A row fetched by id is checked with
  `canAccessTenant` and answers 404 when out of scope. See
  [Tenancy](./tenancy.md#how-a-read-is-scoped).
- **File paths** come from
  [`lib/storage-paths.ts`](../apps/backend/src/lib/storage-paths.ts), never from
  `process.cwd()` or a literal under `data/`.
- **Timestamps** are INTEGER milliseconds, defaulting to
  `unixepoch('now', 'subsec') * 1000`, typed `number` in `packages/types`. A
  calendar day is a Lima day: `limaRangeEdge` in `db/query.ts` on the server,
  [`formatters.ts`](../apps/frontend/src/lib/utils/formatters.ts) in the
  dashboard.
- **Booleans** are INTEGER columns with `CHECK(x IN (0, 1))`.
- **Paging.** A list route reads `limit` and `offset` with `queryLimit` and
  `queryOffset` from [`lib/http.ts`](../apps/backend/src/lib/http.ts). A bad
  value answers 400. `limit` is at most 500. A path parameter is read with
  `pathParam`.
- **Audit.** A route that changes data calls `logAction` from
  [`platform/audit/logger.ts`](../apps/backend/src/platform/audit/logger.ts).
- **Sends** go through `WhatsAppService` and act on the `SendResult` it returns.
  Most failures come back as an outcome, not a throw. An inactive number throws
  `ChannelUnavailableError`.
- **Schema.** A new table goes in `schema.sql`. A change to an existing table
  also needs a step in `migrations.ts`.
- **Commits.** A lower-case imperative subject with no prefix, then a body that
  explains why, usually starting with `Why:`. Commits to `master` are signed.

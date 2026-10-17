# Development

This covers the checks, what CI runs, where versions are pinned, how the tests
are laid out, and the conventions a change follows. Where a change belongs is in
[Architecture](./architecture.md#where-a-change-belongs).

## Checks

Run from the repository root unless a directory is named.

| Command                               | What it catches                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bun test`                            | every test file in the repository: backend, core, frontend                                          |
| `bunx tsc --noEmit` in each workspace | type errors. Run it in `apps/backend` and each of `packages/{core,intelligence,logger,types,utils}` |
| `bun run check` in `apps/frontend`    | svelte-check: types and Svelte errors in the dashboard                                              |
| `bunx biome format`                   | formatting of code and JSON. `bun run format` writes the fixes                                      |
| `bun run format:md`                   | formatting of Markdown and YAML, with prettier. It writes the fixes                                 |
| `bun run build`                       | the production frontend build                                                                       |

`bun run format` runs `biome format --write`. It does not lint.
`bunx biome lint` is clean on the current tree. CI does not run it.

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

The `test` job runs a `postgres:18` service and sets `TEST_DATABASE_URL` to it.

[`codeql.yml`](../.github/workflows/codeql.yml) adds `analyze (actions)` and
`analyze (javascript-typescript)`. Branch protection is configured on GitHub
rather than in this repository and is not described here.

Every job installs with `bun install --frozen-lockfile`. A `package.json` change
without its `bun.lock` update fails CI.

The `typecheck` matrix and the `test` job name their workspaces by hand. A new
workspace is neither typechecked nor tested in CI until it is added to both.

## Where the pins live

| Pin                                  | File                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| bun, biome, postgres                 | [`mise.toml`](../mise.toml), resolved in `mise.lock`               |
| npm dependencies                     | `bun.lock`, installed with `--frozen-lockfile`                     |
| transitive versions forced for fixes | `overrides` in the root [`package.json`](../package.json)          |
| GitHub Actions                       | the `uses:` lines in `.github/workflows/`                          |
| `typescript`                         | an alias to `typescript-native-bridge`, in the root `package.json` |

`typescript-native-bridge` keeps the classic `typescript` API that SvelteKit and
`svelte-check` call and runs the TypeScript 7 (tsgo) checker behind it. The root
`overrides` entry makes every package that depends on `typescript` resolve to
it, so `bunx tsc` and `svelte-check` both type-check with tsgo. The first check
in a process prints `TNB ACTIVE` to stderr.

`mise install` installs the pinned tools. Dependabot
([`dependabot.yml`](../.github/dependabot.yml)) updates the bun dependencies
daily and the actions weekly. It does not update `mise.toml`.

### Keeping the mise pins current

[`mise-pins.yml`](../.github/workflows/mise-pins.yml) runs every Monday and on
demand. It runs [`check-mise-pins.sh`](../.github/scripts/check-mise-pins.sh),
which prints pins behind their latest release. The workflow keeps one open
issue, "Update the pins in mise.toml", synchronized with that list:

| The script prints | The workflow                       |
| ----------------- | ---------------------------------- |
| outdated pins     | opens the issue, or rewrites it    |
| nothing           | closes the issue if one is open    |
| fails             | leaves the issue as it is, run red |

`mise outdated` omits a tool whose lookup failed and exits 0, the same as for a
current tool. The script therefore accepts a pin only when `mise outdated` lists
it or `mise latest` returns the pinned version. A pin that meets neither
condition fails the run and names the tool. Pins in `mise.toml` must be exact
versions because a range never equals the latest version.

To bump a pin, edit `mise.toml` and run `mise lock` to rewrite its entry in
`mise.lock`. To run the check locally, run `.github/scripts/check-mise-pins.sh`
from the repository root.

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

A test that needs Postgres calls `createTestDb` from
[`tests/helpers/postgres.ts`](../apps/backend/tests/helpers/postgres.ts), which
returns a migrated database of its own, cloned from a template in about 20 ms,
and `destroy()` drops it. The first call builds the template with the real
migrations. The server is the one `TEST_DATABASE_URL` names, which must allow
creating databases. Without it, the helper starts a throwaway server from the
`initdb` and `pg_ctl` on `PATH` (`mise install` provides them) and stops it when
the run ends. With neither, a suite written as
`describe.skipIf(!postgresAvailable)` skips.

Some backend tests boot the real server or open the database from several
processes (`boot-safety`, `concurrent-startup`).

`packages/core/tests/` is not typechecked: core's `tsconfig.json` includes `src`
only.

The tests that hold the architecture's boundaries are listed in
[Architecture](./architecture.md#tests-that-enforce-structure).

## Conventions

These are what the code does today.

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
- **Schema.** `schema.sql` is the whole schema and never alters a table that
  exists. After changing a table, delete the database file and restart the
  backend. The Postgres schema is different: a change is a new file in
  `db/migrations/` and an edit to `db/types.ts`, never an edit to a migration
  that has run.
- **Commits.** A lower-case imperative subject with no prefix, then a body that
  explains why, usually starting with `Why:`. Commits to `master` are signed.

# Development

This covers the checks, what CI runs, where versions are pinned, how the tests
are laid out, and the conventions a change follows. Where a change belongs is in
[Architecture](./architecture.md#where-a-change-belongs).

## Checks

Run from the repository root. [mise](https://mise.jdx.dev) installs the pinned
tools, and the scripts in the root [`package.json`](../package.json) are the
checks.

| Command                         | What it does                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| `bun install --frozen-lockfile` | installs from `bun.lock` and fails if the lockfile is out of date     |
| `bun run lint`                  | Biome lint and format check on code, oxfmt check on the rest          |
| `bun run fix`                   | Biome safe fixes and formatting, oxfmt formatting. It writes files    |
| `bun run typecheck`             | `typecheck` in every workspace: tsc, and svelte-check for the website |
| `bun run test`                  | every test file except `*.integration.test.ts`. It needs no service   |
| `bun run test:integration`      | the `*.integration.test.ts` files, which need Postgres                |
| `bun run build`                 | the production frontend build                                         |
| `bun run check`                 | `lint`, `typecheck`, `test` and `build`. It needs no service          |

`lint` and `fix` have parts, `lint:js`, `lint:fmt`, `fix:js` and `fix:fmt`.
Biome formats code. oxfmt formats Markdown, YAML and JSON.

`apps/backend` has `bun run test:llm`, which runs one file against the mock LLM
provider. It does not call a model.

## What CI runs

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml), on every pull request
and push to `master`, has two jobs. Each installs the pinned tools with mise and
runs `bun install --frozen-lockfile`. `check` then runs `bun run check`.
`integration` runs a `postgres:18` service, sets `TEST_DATABASE_URL` to it and
runs `bun run test:integration`. `MISE_DISABLE_TOOLS=postgres` keeps mise from
compiling its own server in both jobs.

[`codeql.yml`](../.github/workflows/codeql.yml) adds `analyze (actions)` and
`analyze (javascript-typescript)`.
[`deploy.yml`](../.github/workflows/deploy.yml) builds and publishes the changed
Docker images on pushes to `master`; its deployment procedure is in
[Deploy](./deploy.md). Branch protection is configured on GitHub rather than in
this repository and is not described here.

A `package.json` change without its `bun.lock` update fails
`bun install --frozen-lockfile`.

A new workspace needs a `typecheck` script, which `bun run typecheck` runs. Its
tests run with the rest under `bun test`.

## Where the pins live

| Pin                                  | File                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| bun, postgres                        | [`mise.toml`](../mise.toml), resolved in `mise.lock`               |
| biome, oxfmt, npm dependencies       | `bun.lock`, installed with `--frozen-lockfile`                     |
| transitive versions forced for fixes | `overrides` in the root [`package.json`](../package.json)          |
| GitHub Actions                       | the `uses:` lines in `.github/workflows/`                          |
| `typescript`                         | an alias to `typescript-native-bridge`, in the root `package.json` |

`typescript-native-bridge` keeps the classic `typescript` API that SvelteKit and
`svelte-check` call and runs the TypeScript 7 (tsgo) checker behind it. The root
`overrides` entry makes every package that depends on `typescript` resolve to
it, so `tsc` and `svelte-check` both type-check with tsgo. The first check in a
process prints `TNB ACTIVE` to stderr.

`mise install` installs the pinned tools. Dependabot
([`dependabot.yml`](../.github/dependabot.yml)) updates the Bun dependencies,
GitHub Actions, Docker images, and Docker Compose definitions weekly. It does
not update `mise.toml`.

To bump a pin, edit `mise.toml` to an exact version and run `mise lock` to
rewrite its entry in `mise.lock`. The deploy workflow and the image builds read
the Bun version from `mise.toml`, so it is stated nowhere else.

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

A test that needs Postgres lives in a file named `*.integration.test.ts`, so
`bun run test` skips it, and calls `createTestDb` from
[`tests/helpers/postgres.ts`](../apps/backend/tests/helpers/postgres.ts), which
returns a migrated database of its own, cloned from a template, and `destroy()`
drops it. The first call builds the template with the real migrations. The
server is the one `TEST_DATABASE_URL` names, which must allow creating
databases. Without it, the helper starts a throwaway server from the `initdb`
and `pg_ctl` on `PATH` (`mise install` provides them) and stops it when the run
ends. With neither, a suite written as `describe.skipIf(!postgresAvailable)`
skips.

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

# Agent guide

VendeYa is described in [readme.md](./readme.md). Read
[architecture.md](./architecture.md) before changing code, and the manual page
for the area you touch ([docs/readme.md](./docs/readme.md)). This file holds
only the rules those documents do not.

## Rules

- **Tenant scope.** A read over a scope that may be null filters with
  `tenantPredicate` from `apps/backend/src/db/query.ts`, never with a hand-built
  `if (tenantId)` branch. A worker that sweeps every tenant uses
  `openTenantsOnly` and `activeChannelAccountsOnly`. Every SELECT of a
  tenant-owned table names a tenant predicate in its own function.
  `tenant-scope-guard.test.ts` checks SELECTs only, so check UPDATE and DELETE
  yourself.
- **File paths** come from `apps/backend/src/lib/storage-paths.ts`.
- **Core stays free of I/O.** If a turn needs the database, a provider or the
  LLM, add an enrichment request and a backend handler
  ([conversation](./docs/conversation.md#the-enrichment-loop)).
- **Sends** go through `WhatsAppService` and act on the returned outcome. Most
  failures come back as an outcome, not a throw. An inactive number throws
  `ChannelUnavailableError`.
- **One backend process.** Locks, the circuit breaker and the workers live in
  memory. Do not add state that assumes a second process shares it, and do not
  design for one.
- **Schema.** A change to an existing table needs a step in
  `apps/backend/src/db/migrations.ts`. `schema.sql` alone never alters a table
  that exists.
- **A new workspace** needs an entry in the CI typecheck matrix, which a test
  enforces, and a step in the CI `test` job, which nothing enforces.
- **Names.** The product is VendeYa. The packages are `@totem/*`, the notifier
  is `totem-notifier`, the repository is `chatbot`. Totem is a tenant, the
  default one. Do not rename in passing.
- **Business rules.** Implement what the code and the owner say. Credit tiers,
  NSE limits and bundle rules found in old notes or dead code (`gaso-logic.ts`)
  are not live rules.

## Before you finish

Run the checks in [Development](./docs/development.md#checks) that cover your
change, at least `bun test`, the typecheck of each workspace you touched, and
`bunx biome format`. Run `bun run format:md` after editing Markdown. Report a
check you could not run.

When behavior changes, change the manual page that describes it in the same
commit. A page that is wrong is worse than none.

## Environment hazards

- Variables set in your shell override the root `.env`. If the shell carries
  real `WHATSAPP_*`, `CALIDDA_*` or `OPENAI_API_KEY` values, a local run uses
  them: it can seed a live number, query Cálidda and send real messages. Run
  local probes with those variables unset.
- `bun test` points the database and uploads at a temporary directory through
  `apps/backend/tests/setup.ts`. A script run outside the test runner uses
  `apps/backend/data/database.sqlite`.
- `bun run dev:tunnel:reset` kills every `cloudflared` process on the machine.

## Commits

A lower-case imperative subject with no prefix, then a body that explains why,
usually starting with `Why:`. `master` requires signed commits and linear
history.

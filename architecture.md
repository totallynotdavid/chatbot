# Architecture

This is the code map, for a contributor deciding where a change goes. How a
message becomes a reply, step by step, is in
[How a conversation runs](./docs/conversation.md).

## Apps and packages

```text
apps/backend           Hono on Bun with bun:sqlite. Webhook intake, the inbox
                       and outbox workers, the bot turn, eligibility providers,
                       notifications, auth, tenancy and the REST API. Owns
                       every piece of state.
apps/frontend          SvelteKit 2 with Svelte 5, built with svelte-adapter-bun.
                       The dashboard, and the public URL Meta posts webhooks
                       to, which it relays to the backend.
apps/notifier          @vendeya/notifier: whatsapp-web.js on one linked WhatsApp
                       account. The backend sends through it only when
                       NODE_ENV is "development".
packages/core          @vendeya/core: the conversation state machine. Phases,
                       copy, intent matching, LLM prompt text. No I/O.
packages/intelligence  @vendeya/intelligence: the OpenAI calls behind
                       IntelligenceProvider.
packages/types         @vendeya/types: types shared by the apps.
packages/utils         @vendeya/utils: service URLs and trace ids.
packages/logger        @vendeya/logger: the pino root logger.
packages/tsconfig      @vendeya/tsconfig: tsconfig bases.
```

Workspace dependencies run one way:

```text
@vendeya/types, @vendeya/utils, @vendeya/logger, @vendeya/tsconfig   no workspace deps
@vendeya/core          -> types, utils
@vendeya/intelligence  -> core, types
@vendeya/backend       -> core, intelligence, logger, types, utils
@vendeya/frontend      -> types, utils
@vendeya/notifier      -> logger, types, utils
```

Every workspace member is named `@vendeya/<directory>`, and the root package is
`vendeya`. The arrows drop the scope.

The frontend never imports the backend or core. It reaches the backend over HTTP
only.

## The path of a customer's message

```text
Meta
  POST <public url>/api/webhook
apps/frontend  routes/api/webhook/+server.ts      relays the raw body, waits
  POST http://localhost:3000/api/webhook          up to 10 s for the verdict
apps/backend   routes/webhook.ts                  signature, route by
                                                  phone_number_id, dedupe
  message_inbox row  (held_messages row during maintenance)
  conversation/aggregator-worker.ts               polls every 100 ms
  conversation/handler/orchestrator.ts            one turn, under the lock
    handler/enrichment-loop.ts  <->  @vendeya/core transition()
      conversation/enrichment/handlers/*          LLM and eligibility calls
    handler/command-executor.ts                   sends, then persists
      adapters/whatsapp/index.ts                  WhatsAppService
        adapters/whatsapp/cloud-api.ts            Graph API send
        failure -> outbox row
          conversation/outbox-worker.ts           retries
          conversation/outbox-handoff.ts          hands the chat to a person
  shared/events -> bootstrap/event-bus-setup.ts   alerts and orders
```

Each step is described in [How a conversation runs](./docs/conversation.md).

## Where state lives

**The SQLite file.** Everything durable is in one database, `DB_PATH`, by
default `apps/backend/data/database.sqlite`. The schema is
[`apps/backend/src/db/schema.sql`](./apps/backend/src/db/schema.sql):

```text
tenancy        tenants, users, tenant_memberships, session,
               channel_accounts, channel_secrets
catalog        catalog_periods, products, catalog_bundles
simulator      test_personas
conversations  conversations, messages, message_inbox, held_messages, outbox
sales          orders, assets
records        analytics_events, llm_calls, notification_traces, audit_log
settings       system_settings, tenant_settings
```

A conversation's phase and metadata are one JSON column,
`conversations.context_data`, shaped `{ phase, metadata }`.
`conversations.current_state` is generated from it.

**Files.** Catalog images live under `UPLOAD_DIR/images` and are public.
Contracts and call recordings live under `PRIVATE_DIR` and are not. See
[Operations](./docs/operations.md#uploads).

**The backend's memory.** These exist only inside the running backend process:

| State                                         | File                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Conversation locks                            | [`conversation/locks.ts`](./apps/backend/src/conversation/locks.ts)                       |
| Which held messages a sweep is answering      | [`conversation/held-messages.ts`](./apps/backend/src/conversation/held-messages.ts)       |
| The provider circuit breaker                  | [`adapters/providers/health.ts`](./apps/backend/src/adapters/providers/health.ts)         |
| The FNB session token, shared by every tenant | [`adapters/providers/fnb-client.ts`](./apps/backend/src/adapters/providers/fnb-client.ts) |
| Login rate-limit counters                     | [`middleware/security.ts`](./apps/backend/src/middleware/security.ts)                     |

The inbox and outbox workers also assume they are the only ones running. The
outbox worker, at boot, records every row left `sending` as an interrupted
attempt, because no other process could be sending it.

This makes the backend one process per database. A second backend on the same
file would not share the locks, could answer the same inbox rows twice, and
would mark the first one's live sends as interrupted at its boot. `bun run seed`
and `bun run account` also open the database, and start no worker. A restart
beside `bun run account` opens the file safely
([`concurrent-startup.test.ts`](./apps/backend/tests/concurrent-startup.test.ts)).

The frontend keeps no state of its own. The notifier keeps its WhatsApp Web
session under `NOTIFIER_DATA_PATH`.

## Deliberate boundaries

- **Core decides, the backend acts.** `transition()` in
  [`packages/core/src/conversation/transition.ts`](./packages/core/src/conversation/transition.ts)
  takes a phase, a message and metadata, and returns commands to run or an
  enrichment to fetch. It performs no I/O. It is not a pure function: copy
  variants are picked with `Math.random`, phases stamp `Date.now()`, and product
  matching writes to `console.log`. Equal inputs can give different replies.
- **Only the backend writes metadata.** Core reads `metadata` and returns
  enrichment requests.
  [`conversation/enrichment/metadata-manager.ts`](./apps/backend/src/conversation/enrichment/metadata-manager.ts)
  folds each enrichment result into it.
- **Business rules are split.** Core holds the flow, the copy, the FNB minimum
  credit and the GASO minimum age. The backend holds which provider's answer
  wins, how a segment is inferred, the price cap on a GASO catalog, order
  creation, the idle reset and reply pacing.
- **Every send goes through `WhatsAppService`.**
  [`adapters/whatsapp/index.ts`](./apps/backend/src/adapters/whatsapp/index.ts)
  re-reads the channel account for each reply, refuses a suspended tenant or an
  inactive number, and reads the token from that account. Alerts to staff go
  through its `sendDirect`, which skips the suspension check. Nothing reads
  `WHATSAPP_TOKEN` at send time.
- **Tenant filters come from one module.** A read over a scope that may be null
  splices `tenantPredicate`, and a worker sweeping every tenant splices
  `openTenantsOnly` and `activeChannelAccountsOnly`, all from
  [`db/query.ts`](./apps/backend/src/db/query.ts). See
  [Tenancy](./docs/tenancy.md#how-a-read-is-scoped).
- **Storage paths come from one module.**
  [`lib/storage-paths.ts`](./apps/backend/src/lib/storage-paths.ts) derives
  every upload root from `UPLOAD_DIR`.
- **The browser talks only to the frontend.** The frontend proxies `/api/*` and
  `/media/*` to the backend at `http://localhost:3000`, a literal in
  [`packages/utils/src/url.ts`](./packages/utils/src/url.ts). The two must run
  on one host.

## Where a change belongs

| Change                                          | Where                                                                                                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What the bot says                               | [`packages/core/src/templates/`](./packages/core/src/templates/)                                                                                                           |
| What a phase does with a message                | [`packages/core/src/conversation/phases/`](./packages/core/src/conversation/phases/)                                                                                       |
| A new phase                                     | the `ConversationPhase` union in `types.ts`, the switch in `transition.ts`, and a phase file                                                                               |
| A turn needs an LLM, a provider or the database | an `EnrichmentRequest` in core's `types.ts`, and a backend handler registered in [`conversation/enrichment/index.ts`](./apps/backend/src/conversation/enrichment/index.ts) |
| LLM prompt text                                 | [`packages/core/src/content/`](./packages/core/src/content/)                                                                                                               |
| The LLM model                                   | [`packages/intelligence/src/config.ts`](./packages/intelligence/src/config.ts)                                                                                             |
| Minimum FNB credit, minimum GASO age            | [`fnb-logic.ts`](./packages/core/src/eligibility/fnb-logic.ts), [`collecting-age.ts`](./packages/core/src/conversation/phases/collecting-age.ts)                           |
| Provider calls and which answer wins            | [`apps/backend/src/domains/eligibility/`](./apps/backend/src/domains/eligibility/)                                                                                         |
| Who is alerted, and the alert text              | [`domains/notifications/config.ts`](./apps/backend/src/domains/notifications/config.ts), [`templates.ts`](./apps/backend/src/domains/notifications/templates.ts)           |
| An API endpoint                                 | [`apps/backend/src/routes/`](./apps/backend/src/routes/), mounted in [`index.ts`](./apps/backend/src/index.ts)                                                             |
| A table                                         | [`schema.sql`](./apps/backend/src/db/schema.sql)                                                                                                                           |
| A column on an existing table                   | `schema.sql` and a step in [`migrations.ts`](./apps/backend/src/db/migrations.ts)                                                                                          |
| A dashboard page                                | [Dashboard](./docs/dashboard.md#adding-a-page)                                                                                                                             |

`schema.sql` runs on every boot and uses `CREATE TABLE IF NOT EXISTS`, so it
never changes a table that already exists.

## Tests that enforce structure

These tests fail the build when a boundary above is crossed. All are in
[`apps/backend/tests/`](./apps/backend/tests/).

| Test                           | What it holds                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `tenant-scope-guard.test.ts`   | No hand-built conditional tenant filter, and every SELECT of a tenant-owned table names a tenant predicate. |
| `storage-path-guard.test.ts`   | Upload paths come from `lib/storage-paths.ts`, never `process.cwd()` or a literal.                          |
| `typecheck-coverage.test.ts`   | Every workspace with a `tsconfig.json` has an entry in the CI typecheck matrix.                             |
| `toolchain-pins.test.ts`       | The bun pinned in `mise.toml` has the major and minor version of `@types/bun`.                              |
| `timestamp-type-guard.test.ts` | A `*_at` type matches its column: `number` over INTEGER. The frontend never types one as `string`.          |
| `created-at-contract.test.ts`  | Each INTEGER `*_at` field reaches the client as milliseconds.                                               |
| `lima-date-contract.test.ts`   | The dashboard and the server name the same Lima calendar day for every instant.                             |
| `foreign-keys.test.ts`         | The app's connection turns on `PRAGMA foreign_keys`.                                                        |
| `webhook-proxy.test.ts`        | The frontend's webhook proxy passes a backend refusal on to Meta.                                           |
| `maintenance-freeze.test.ts`   | The API, not only the dashboard, refuses to answer held messages during a freeze.                           |
| `boot-safety.test.ts`          | Boot creates no account, warns with no operator, and a throwing seed stops boot before the port is bound.   |

The full list of checks and what CI runs is in
[Development](./docs/development.md).

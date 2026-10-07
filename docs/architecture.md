# Architecture

This is the code map for contributors. It names the boundary between the
conversation core and the backend, shows how a message becomes a reply, and
points to the owner of each change. The user-facing flow is in
[How a conversation runs](./conversation.md).

## Workspaces

| Workspace               | Owns                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/backend`          | Hono API, SQLite state, webhook intake, conversation and outbox workers, provider calls, authentication, tenancy, notifications, and domain routes. |
| `apps/frontend`         | SvelteKit 3 with Svelte 5: dashboard, server-side session checks, the HTTP and media proxies, and the public webhook endpoint.                      |
| `apps/notifier`         | The development-only `whatsapp-web.js` adapter and its linked WhatsApp Web session.                                                                 |
| `packages/core`         | Conversation phases, validation, matching, templates, and the transition contract. It does not call external services.                              |
| `packages/intelligence` | The OpenAI-backed `IntelligenceProvider` and its prompts.                                                                                           |
| `packages/types`        | Types shared by the applications and packages.                                                                                                      |
| `packages/utils`        | Shared service URLs and trace-id helpers.                                                                                                           |
| `packages/logger`       | The shared Pino logger.                                                                                                                             |
| `packages/tsconfig`     | TypeScript configuration bases used by the workspaces.                                                                                              |

Workspace dependencies point inward:

```text
types, utils, logger, tsconfig
core            -> types, utils
intelligence    -> core, types
backend         -> core, intelligence, logger, types, utils
frontend        -> types, utils
notifier        -> logger, types, utils
```

The browser talks to the frontend. The frontend calls the backend over HTTP at
`http://localhost:3000`. The backend does not import frontend code.

## Request path

```text
Meta
  POST /api/webhook
apps/frontend  routes/api/webhook/+server.ts
  relays the raw body to http://localhost:3000 and waits up to 10 s for its verdict
apps/backend   routes/webhook.ts
  verifies, routes by phone_number_id, deduplicates, and stores the message
  message_inbox row (or held_messages during maintenance)
conversation/aggregator-worker.ts
  waits for the quiet window, groups one contact's messages, and starts a turn
conversation/handler/orchestrator.ts
  locks the conversation and runs the enrichment loop
conversation/handler/enrichment-loop.ts <-> packages/core transition()
  core returns commands or asks the backend for an enrichment
conversation/handler/command-executor.ts
  sends commands, records the phase, and records analytics events
adapters/whatsapp/index.ts
  uses DevAdapter in development and CloudApiAdapter otherwise
conversation/outbox-worker.ts
  retries recoverable failures and outbox-handoff.ts escalates a failed reply
shared/events + bootstrap/event-bus-setup.ts
  dispatch domain events such as orders and escalation alerts
```

The complete turn, including the phase table and failure states, is in
[How a conversation runs](./conversation.md). Provider selection and recovery
are in [Eligibility](./eligibility.md).

## Durable state

The backend stores durable state in one SQLite database. `DB_PATH` defaults to
`apps/backend/data/database.sqlite` when the backend is run from its directory.
The schema is [`db/schema.sql`](../apps/backend/src/db/schema.sql).

| Area                  | Tables or files                                                                         |
| --------------------- | --------------------------------------------------------------------------------------- |
| Tenancy and auth      | `tenants`, `users`, `tenant_memberships`, `session`                                     |
| Channel credentials   | `channel_accounts`, encrypted `channel_secrets`                                         |
| Catalog and simulator | `catalog_periods`, `products`, `catalog_bundles`, `test_personas`                       |
| Conversations         | `conversations`, `messages`, `message_inbox`, `held_messages`, `outbox`                 |
| Sales and records     | `orders`, `assets`, `analytics_events`, `llm_calls`, `notification_traces`, `audit_log` |
| Settings              | `system_settings`, `tenant_settings`                                                    |

A conversation's phase and metadata are one JSON column,
`conversations.context_data`, shaped `{ phase, metadata }`.
`conversations.current_state` is generated from it.

Catalog images are stored below `UPLOAD_DIR/images` and served without
authentication so Meta can fetch them. Contracts and call recordings are under
`PRIVATE_DIR` and are served only through the tenant-checked assets route. Both
roots are derived in
[`lib/storage-paths.ts`](../apps/backend/src/lib/storage-paths.ts).

The backend also has process-local state:

| State                                         | Owner                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Conversation locks                            | [`conversation/locks.ts`](../apps/backend/src/conversation/locks.ts)                       |
| Which held messages a sweep is answering      | [`conversation/held-messages.ts`](../apps/backend/src/conversation/held-messages.ts)       |
| The provider circuit breaker                  | [`adapters/providers/health.ts`](../apps/backend/src/adapters/providers/health.ts)         |
| The FNB session token, shared by every tenant | [`adapters/providers/fnb-client.ts`](../apps/backend/src/adapters/providers/fnb-client.ts) |
| Login rate-limit counters                     | [`middleware/security.ts`](../apps/backend/src/middleware/security.ts)                     |

The inbox and outbox workers assume they are the only ones running. At boot, the
outbox worker records every row left `sending` as an interrupted attempt,
because no other process could be sending it.

This makes the backend one process per database. A second backend on the same
file would not share the locks, could answer the same inbox rows twice, and
would mark the first one's live sends as interrupted at its boot. `bun run seed`
and `bun run account` also open the database, and start no worker. A restart
beside `bun run account` opens the file safely
([`concurrent-startup.test.ts`](../apps/backend/tests/concurrent-startup.test.ts)).

The frontend keeps no state of its own. The notifier keeps its WhatsApp Web
session under `NOTIFIER_DATA_PATH`. See [Operations](./operations.md) for
deployment details.

## Boundaries

- Core returns a final update or an enrichment request. The backend handles the
  database, providers, LLM, and WhatsApp calls, then feeds enrichment results
  back to core. The contract is in
  [`conversation/types.ts`](../packages/core/src/conversation/types.ts).
- `transition()` in
  [`packages/core/src/conversation/transition.ts`](../packages/core/src/conversation/transition.ts)
  performs no I/O but is not a pure function: copy variants use `Math.random`,
  phases stamp `Date.now`, and product matching writes to `console.log`. Equal
  inputs can give different replies.
- Only the backend writes metadata. Core reads `metadata` and returns enrichment
  requests.
  [`metadata-manager.ts`](../apps/backend/src/conversation/enrichment/metadata-manager.ts)
  folds each enrichment result into it.
- Business rules are split. Core holds the flow, copy, FNB minimum credit, and
  GASO minimum age. The backend holds which provider answer wins, how a segment
  is inferred, the GASO catalog price cap, order creation, idle reset, and reply
  pacing.
- Every WhatsApp send uses `WhatsAppService` in
  [`adapters/whatsapp/index.ts`](../apps/backend/src/adapters/whatsapp/index.ts).
  It rechecks the tenant and channel account before sending and returns a typed
  outcome for most failures. An inactive account throws
  `ChannelUnavailableError` so its queue can wait. Alerts to staff use
  `sendDirect`, which skips the suspension check.
- Tenant scope comes from [`db/query.ts`](../apps/backend/src/db/query.ts). Read
  functions use `tenantPredicate`. Cross-tenant workers use `openTenantsOnly`
  and `activeChannelAccountsOnly`.
- A new table belongs in `schema.sql`. A change to an existing table also needs
  a migration in [`db/migrations.ts`](../apps/backend/src/db/migrations.ts).
- The browser talks only to the frontend. The frontend proxies `/api/*` and
  `/media/*` to the literal `http://localhost:3000` in
  [`packages/utils/src/url.ts`](../packages/utils/src/url.ts); the frontend and
  backend must share a host.

## Where a change belongs

| Change                                | Owner                                                                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation phase or transition      | [`packages/core/src/conversation/`](../packages/core/src/conversation/)                                                                                                                               |
| Bot copy or prompt text               | [`packages/core/src/templates/`](../packages/core/src/templates/) or [`packages/core/src/content/`](../packages/core/src/content/)                                                                    |
| New phase                             | The `ConversationPhase` union in [`types.ts`](../packages/core/src/conversation/types.ts), the switch in `transition.ts`, and a phase file                                                            |
| External data needed by a turn        | An `EnrichmentRequest` in [`conversation/types.ts`](../packages/core/src/conversation/types.ts), plus a backend handler in [`conversation/enrichment/`](../apps/backend/src/conversation/enrichment/) |
| LLM model                             | [`packages/intelligence/src/config.ts`](../packages/intelligence/src/config.ts)                                                                                                                       |
| Minimum FNB credit, minimum GASO age  | [`fnb-logic.ts`](../packages/core/src/eligibility/fnb-logic.ts), [`collecting-age.ts`](../packages/core/src/conversation/phases/collecting-age.ts)                                                    |
| Provider behavior or result selection | [`apps/backend/src/domains/eligibility/`](../apps/backend/src/domains/eligibility/)                                                                                                                   |
| WhatsApp transport                    | [`apps/backend/src/adapters/whatsapp/`](../apps/backend/src/adapters/whatsapp/)                                                                                                                       |
| API endpoint                          | [`apps/backend/src/routes/`](../apps/backend/src/routes/)                                                                                                                                             |
| Dashboard page                        | [`apps/frontend/src/routes/dashboard/`](../apps/frontend/src/routes/dashboard/)                                                                                                                       |
| Catalog data or rules                 | [`apps/backend/src/domains/catalog/`](../apps/backend/src/domains/catalog/)                                                                                                                           |
| New table                             | [`apps/backend/src/db/schema.sql`](../apps/backend/src/db/schema.sql)                                                                                                                                 |
| Column on an existing table           | `schema.sql` and a step in [`apps/backend/src/db/migrations.ts`](../apps/backend/src/db/migrations.ts)                                                                                                |
| Notification recipient or text        | [`apps/backend/src/domains/notifications/`](../apps/backend/src/domains/notifications/)                                                                                                               |
| Uploaded-file location                | [`apps/backend/src/lib/storage-paths.ts`](../apps/backend/src/lib/storage-paths.ts)                                                                                                                   |

## Tests that enforce structure

These tests live in [`apps/backend/tests/`](../apps/backend/tests/):

| Test                          | Holds                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `tenant-scope-guard.test.ts`  | Tenant predicates on SELECTs and rejects hand-built conditional tenant filters.                    |
| `created-at-contract.test.ts` | INTEGER `*_at` fields reach clients as milliseconds.                                               |
| `lima-date-contract.test.ts`  | The server and dashboard name the same Lima calendar day.                                          |
| `foreign-keys.test.ts`        | The application connection enables `PRAGMA foreign_keys`.                                          |
| `webhook-proxy.test.ts`       | The frontend relays backend webhook refusals to Meta.                                              |
| `maintenance-freeze.test.ts`  | The API refuses held messages during a freeze.                                                     |
| `boot-safety.test.ts`         | Boot creates no account, warns without an operator, and does not bind a port after a seed failure. |
| `concurrent-startup.test.ts`  | The account command can open the database safely beside a booting backend.                         |

`schema.sql` runs on every boot and uses `CREATE TABLE IF NOT EXISTS`, so it
never changes a table that already exists.

The commands and CI matrix are in [Development](./development.md).

# Operations

This is for whoever runs a deployment and answers when it breaks.

## What runs

A production deployment runs two processes on one host:

```sh
bun install --frozen-lockfile
bun run build                                    # builds apps/frontend/dist
bun run --cwd apps/backend start                 # backend on :3000
PORT=5173 bun apps/frontend/dist/index.js
```

- The backend listens on `PORT`, default 3000. The frontend reaches it at
  `http://localhost:3000` whatever `PORT` says, so leave it at 3000.
- The built frontend also reads `PORT`, and its default is 3000 too. Give it
  another port.
- The backend sends every reply through the Cloud API.
- Run one backend per database. Its locks and workers live in memory
  ([Architecture](./architecture.md#durable-state)).

The backend and development frontend scripts load the root `.env` with
`--env-file=../../.env`. `.env.production.example` lists production values to
copy into it.

## Boot

[`apps/backend/src/index.ts`](../apps/backend/src/index.ts), in order:

1. Check the Graph settings, described in
   [WhatsApp](./whatsapp.md#connecting-whatsapp).
2. Open the database (`DB_PATH`, default `./data/database.sqlite` relative to
   `apps/backend`) and apply [`schema.sql`](../apps/backend/src/db/schema.sql),
   which alters no existing table
   ([Architecture](./architecture.md#boundaries)).
3. Run the seed: tenant `totem`, its channel account, the sample catalog and,
   outside production, test conversations. It runs on every boot.
4. Warn if no platform operator can log in, and if `WHATSAPP_APP_SECRET` is
   unset.
5. Start the aggregator and the outbox worker, a 60 s agent-reassignment timer,
   and an hourly purge of processed inbox rows and final outbox rows. A timer
   task that throws is logged as "Scheduled task failed" and runs again on the
   next tick.
6. Listen.

Boot checks nothing else. A missing `SECRETS_KEY`, provider credential, LLM key
or `PUBLIC_URL` shows up when it is first used.

## Environment

| Variable                                                               | Read by           | Without it                                                                                           |
| ---------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                             | all               | test data is seeded and the simulator routes answer; `production` skips both and sets secure cookies |
| `DB_PATH`                                                              | backend           | `./data/database.sqlite`                                                                             |
| `UPLOAD_DIR`, `PRIVATE_DIR`                                            | backend           | see [Uploads](#uploads)                                                                              |
| `SECRETS_KEY`                                                          | backend           | no channel token can be stored or read                                                               |
| `PUBLIC_URL`                                                           | backend           | image links, alert links and the CORS origin name `http://localhost:5173`                            |
| `WHATSAPP_APP_SECRET`                                                  | backend           | every webhook POST answers 503                                                                       |
| `WHATSAPP_PHONE_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | seed              | the default tenant's number is a `pending` placeholder                                               |
| `GRAPH_API_VERSION`                                                    | backend           | see [WhatsApp](./whatsapp.md#connecting-whatsapp)                                                    |
| `GRAPH_API_BASE_URL`                                                   | backend           | see [WhatsApp](./whatsapp.md#connecting-whatsapp)                                                    |
| `PLATFORM_OPS_PHONE_NUMBER_ID`                                         | backend           | platform alerts go out on `WHATSAPP_PHONE_ID`'s account                                              |
| `WHATSAPP_GROUP_AGENT`, `WHATSAPP_GROUP_DEV`                           | backend           | sales and dev alerts with no tenant setting have no target. See [Alerts](#alerts)                    |
| `CALIDDA_*`, `POWERBI_*`                                               | backend           | that eligibility provider fails at every check                                                       |
| `OPENAI_API_KEY`                                                       | backend           | any message the regexes miss gets no reply                                                           |
| `BOT_RESPONSE_DELAY_MS`                                                | backend           | 2300                                                                                                 |
| `COOKIE_SECURE`                                                        | backend           | secure cookies only in production                                                                    |
| `PORT`                                                                 | backend, frontend | 3000                                                                                                 |
| `BODY_SIZE_LIMIT`                                                      | built frontend    | 64M. See [Uploads](#uploads)                                                                         |
| `LOG_DIR`                                                              | backend           | `./data/logs`, relative to `apps/backend`                                                            |
| `LOG_LEVEL`, `LOG_LEVEL_<MODULE>`                                      | all               | `info`                                                                                               |

## Accounts

The seed and boot create no user. Every first account comes from the command
line ([`cli/account.ts`](../apps/backend/src/cli/account.ts)):

```sh
bun run account create <username> [--platform-operator | --tenant <tenant id>] [--name <display name>]
bun run account promote <username>
```

- `create` makes an `admin` of the tenant given by `--tenant`, which takes the
  tenant's id, not its slug. With exactly one tenant, `--tenant` can be left
  off. `--platform-operator` makes a platform operator with no membership
  instead. The two flags exclude each other.
- `promote` makes an existing, active account a platform operator and keeps its
  memberships. Promoting an operator changes nothing.

The password is read from a hidden prompt, twice, or from stdin when stdin is
not a terminal:

```sh
printf '%s\n' "$PASSWORD" | bun run account create <username>
```

It must be at least 12 characters. It is never taken from an argument or the
environment. The command exits 0 on success, 1 when refused, 2 on a usage error.
It applies the schema but not the seed, so `create` needs a tenant: run the seed
or boot the backend first. Both actions are written to the audit log with the
actor `cli:<os user>`.

**When no platform operator can log in**, boot logs a warning. Nobody can then
create a tenant, act across tenants or change platform settings. On the server,
create a new operator or promote an existing account:

```sh
bun run account create <new username> --platform-operator
bun run account promote <username>
```

The command line cannot reset a password. The API resets a password only for a
member of the caller's active tenant (`POST /api/admin/users/:id/password`), so
an operator with no membership who lost theirs is replaced: create a new
operator.

## Uploads

Uploaded files split by who may read them. The roots come from
[`lib/storage-paths.ts`](../apps/backend/src/lib/storage-paths.ts):

| Directory             | Holds                                | Read by                                                                                                          |
| --------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `<UPLOAD_DIR>/images` | catalog images, named by random id   | anyone: served unauthenticated at `/media/images/<id>.jpg`, because Meta fetches image links with no credentials |
| `PRIVATE_DIR`         | signed contracts and call recordings | nobody directly. Only `GET /api/assets/:id`, after checking the caller's tenant                                  |

`UPLOAD_DIR` defaults to `./data/uploads`. `PRIVATE_DIR` defaults to `private`
beside `UPLOAD_DIR`. Both are relative to `apps/backend` unless absolute. In
production, point `UPLOAD_DIR` at a persistent volume: the asset rows in the
database outlive a redeploy, and the files must too.

The built frontend server refuses a request body over 64 MiB with 413, before
any route runs. That is the largest upload: an hour of 8 kHz mono WAV is about
55 MiB. The limit is set at build time in
[`vite.config.ts`](../apps/frontend/vite.config.ts), and `BODY_SIZE_LIMIT` at
run time replaces it. The webhook route holds Meta's webhook to 3 MiB regardless
(see [Connecting WhatsApp](./whatsapp.md#body-size)), so leave `BODY_SIZE_LIMIT`
unset.

The seeded catalog photos are tracked in `apps/backend/data/uploads/images`.
Every boot copies any that are missing into `<UPLOAD_DIR>/images`.

## Health

```sh
curl http://localhost:3000/health
```

`GET /health` needs no session and reads no database. It always answers 200:

```json
{
  "status": "healthy",
  "providers": {
    "fnb": {
      "status": "healthy",
      "available": true,
      "lastError": null,
      "blockedUntil": null
    },
    "gaso": {
      "status": "healthy",
      "available": true,
      "lastError": null,
      "blockedUntil": null
    },
    "powerbi": {
      "status": "healthy",
      "available": true,
      "lastError": null,
      "blockedUntil": null
    }
  },
  "timestamp": "2026-09-21T02:25:34.190Z"
}
```

`status` is `healthy` when the `fnb` and `gaso` entries are available. The rest
of the time it is `degraded`. Two things follow from how that is computed:

- The circuit breaker blocks `powerbi`, never `gaso`, and `powerbi` is not in
  the computation. A blocked Power BI leaves `status` unchanged.
- `providers` reflects the in-memory circuit breaker and the last error it
  recorded. It is not a live check of the providers.

`lastError` carries the provider's raw error message.

Nothing in the repository calls `/health`.

## Logs

The backend writes one JSON object per line to `backend.log` in `LOG_DIR`,
default `data/logs` relative to `apps/backend`. In production that file is the
only output. In development the same lines also print to the terminal.
`LOG_LEVEL` sets the level, and `LOG_LEVEL_<MODULE>` overrides it for one
module.

A failure carries an `error` object with `type`, `message` and `stack`, and the
`code` or cause the error has. To list every error:

```sh
grep '"level":50' "${LOG_DIR:-apps/backend/data/logs}/backend.log"
```

## Alerts

Alerts are WhatsApp messages sent by the backend on events
([`domains/notifications/config.ts`](../apps/backend/src/domains/notifications/config.ts)):

| Event                                                  | Goes to                                   |
| ------------------------------------------------------ | ----------------------------------------- |
| escalation, attention required, order created          | the assigned agent, else the sales target |
| customer message to a held conversation                | the assigned agent only                   |
| agent assigned                                         | the agent's phone                         |
| system error, outage, provider degraded, loop exceeded | the dev target                            |

The sales target is the tenant setting `whatsapp_group_sales`, else
`WHATSAPP_GROUP_AGENT`. The dev target is `whatsapp_group_dev`, else
`WHATSAPP_GROUP_DEV`. A tenant admin sets the tenant values:

```sh
curl -X POST -b "session=<token>" -H 'content-type: application/json' \
  -d '{"whatsapp_group_sales":"<number or group id>"}' \
  https://<frontend>/api/admin/settings
```

An alert about a tenant goes out on the event's own number, else the tenant's
default number. A tenant with no number gets no alert: the trace is recorded as
failed with reason `no_channel_account`, and the alert never leaves from the
platform operations number. An alert with no tenant, such as both eligibility
providers being down, goes out on the platform operations number. Every decision
is recorded in `notification_traces`.

`WHATSAPP_GROUP_AGENT` and `WHATSAPP_GROUP_DEV` are VendeYa's own operations
groups. They receive the alerts of every tenant that has no setting of its own,
and those alerts carry the customer's name, phone and DNI, so they must hold
only VendeYa staff. A business that wants its own alerts gets
`whatsapp_group_sales` and `whatsapp_group_dev` set.

Alert links and the backend's CORS origin come from `PUBLIC_URL`, the address
image links use too, with any trailing slash removed
([`packages/utils/src/url.ts`](../packages/utils/src/url.ts)). The CORS origin
is read once, at boot, so restart the backend after changing `PUBLIC_URL`.

## The audit log

Writes made through the API record who did what in `audit_log`: user, catalog,
period, order, conversation, channel account, tenant and settings changes, and
the eligibility retry sweep. Each row has the actor (`user:<id>` or
`cli:<os user>`), the tenant, the action and the resource. The writer is
[`platform/audit/logger.ts`](../apps/backend/src/platform/audit/logger.ts).

Admins read it at `/dashboard/admin/audit`, backed by `GET /api/admin/audit`. A
pinned admin sees their tenant. An unpinned operator also sees platform actions.
A `send_message` row whose delivery WhatsApp did not confirm carries a "Entrega
sin confirmar" mark; see [the send](./conversation.md#the-send).

## When customers get no reply

| Check                                    | Where                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Webhooks arrive at all                   | the backend log: "Webhook POST rejected" or "refused" names signature, size or secret  |
| The number is `active`                   | `GET /api/admin/channels`                                                              |
| The tenant is not suspended              | `GET /api/tenants`                                                                     |
| The turn failed                          | the log line "Message processing failed", and the dev alert                            |
| The reply failed to send                 | `messages.status` `failed` or `queued`; the `outbox` row's `last_reason`               |
| The conversation is waiting on providers | phase `waiting_for_recovery`; see [Eligibility](./eligibility.md#outages-and-recovery) |
| The conversation is with a person        | phase `escalated`; the bot stays silent until release                                  |

Failed turns and crashes are retried and handed off as
[Conversation](./conversation.md#the-inbox-and-the-aggregator) describes.
`message_inbox.last_error` keeps the error. The inbox rows are not in the
dashboard, but the conversation is.

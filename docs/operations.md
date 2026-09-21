# Operations

This is for whoever runs a deployment and answers when it breaks.

## What runs

A production deployment runs two processes on one host:

```sh
bun install --frozen-lockfile
bun run build                                    # builds apps/frontend/dist
bun run --cwd apps/backend start                 # backend on :3000
PORT=5173 BODY_SIZE_LIMIT=3M bun apps/frontend/dist/index.js
```

- The backend listens on `PORT`, default 3000. The frontend reaches it at
  `http://localhost:3000` whatever `PORT` says, so leave it at 3000.
- The built frontend also reads `PORT`, and its default is 3000 too. Give it
  another port. `BODY_SIZE_LIMIT` must be `3M` for Meta's webhook (see
  [Connecting WhatsApp](./whatsapp.md#body-size)).
- The notifier is not run. With `NODE_ENV` other than `development`, the backend
  sends through the Cloud API.
- Run one backend per database. Its locks and workers live in memory
  ([Architecture](../architecture.md#where-state-lives)).

The backend, notifier and development frontend scripts load the root `.env` with
`--env-file=../../.env`. `.env.production.example` lists production values to
copy into it.

## Boot

[`apps/backend/src/index.ts`](../apps/backend/src/index.ts), in order:

1. Open the database (`DB_PATH`, default `./data/database.sqlite` relative to
   `apps/backend`) and apply the schema and migrations.
2. Run the seed: tenant `totem`, its channel account, the sample catalog and,
   outside production, test conversations. It runs on every boot.
3. Warn if no platform operator can log in, and if `WHATSAPP_APP_SECRET` is
   unset.
4. Start the aggregator and the outbox worker, a 60 s agent-reassignment timer,
   and an hourly purge of processed inbox rows and final outbox rows.
5. Listen.

Boot checks nothing else. A missing `SECRETS_KEY`, provider credential, LLM key
or `PUBLIC_URL` shows up when it is first used.

## Environment

| Variable                                                               | Read by           | Without it                                                                                     |
| ---------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                             | all               | `development` sends through the notifier; `production` skips test data and sets secure cookies |
| `DB_PATH`                                                              | backend           | `./data/database.sqlite`                                                                       |
| `UPLOAD_DIR`, `PRIVATE_DIR`                                            | backend           | see [Uploads](#uploads)                                                                        |
| `SECRETS_KEY`                                                          | backend           | no channel token can be stored or read                                                         |
| `PUBLIC_URL`                                                           | backend           | image links name `http://localhost:5173`                                                       |
| `WHATSAPP_APP_SECRET`                                                  | backend           | every webhook POST answers 503                                                                 |
| `WHATSAPP_PHONE_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | seed              | the default tenant's number is a `pending` placeholder                                         |
| `PLATFORM_OPS_PHONE_NUMBER_ID`                                         | backend           | platform alerts go out on `WHATSAPP_PHONE_ID`'s account                                        |
| `WHATSAPP_GROUP_AGENT`, `WHATSAPP_GROUP_DEV`                           | backend           | sales and dev alerts with no tenant setting have no target                                     |
| `CALIDDA_*`, `POWERBI_*`                                               | backend           | that eligibility provider fails at every check                                                 |
| `OPENAI_API_KEY`                                                       | backend           | any message the regexes miss gets no reply                                                     |
| `BOT_RESPONSE_DELAY_MS`                                                | backend           | 2300                                                                                           |
| `COOKIE_SECURE`                                                        | backend           | secure cookies only in production                                                              |
| `PORT`                                                                 | backend, frontend | 3000                                                                                           |
| `BODY_SIZE_LIMIT`                                                      | built frontend    | 512K                                                                                           |
| `LOG_LEVEL`, `LOG_LEVEL_<MODULE>`                                      | all               | `info`                                                                                         |
| `NOTIFIER_DATA_PATH`, `CHROME_PATH`, `NOTIFIER_PORT`                   | notifier          | `./data`, puppeteer's Chromium, 3001. The backend always calls 3001                            |

`JWT_SECRET`, `SESSION_SECRET` and `API_KEY` are read by nothing, although
`scripts/generate-token.ts` has presets for them. `GEMINI_API_KEY` is read only
by an image-extraction path nothing calls.

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
It runs the migration but not the seed, so `create` needs a tenant: run the seed
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
  "notifier": { "status": "healthy" },
  "timestamp": "2026-09-21T02:25:34.190Z"
}
```

`status` is `healthy` when the `fnb` and `gaso` entries are available and the
notifier answers. The rest of the time it is `degraded`. Three things follow
from how that is computed:

- Production does not run the notifier, so production always reports `degraded`.
- The circuit breaker blocks `powerbi`, never `gaso`, and `powerbi` is not in
  the computation. A blocked Power BI leaves `status` unchanged.
- `providers` reflects the in-memory circuit breaker and the last error it
  recorded. It is not a live check of the providers.

`lastError` carries the provider's raw error message.

Nothing in the repository calls `/health`.

## Alerts

Alerts are WhatsApp messages sent by the backend on events
([`domains/notifications/config.ts`](../apps/backend/src/domains/notifications/config.ts)):

| Event                                                  | Goes to                                   |
| ------------------------------------------------------ | ----------------------------------------- |
| escalation, attention required, order created          | the assigned agent, else the sales target |
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

An alert goes out on the event's own number, else the tenant's default number,
else the platform operations number. Every decision is recorded in
`notification_traces`.

Alert links are built from `getFrontendUrl()`
([`packages/utils/src/url.ts`](../packages/utils/src/url.ts)), which ignores
`PUBLIC_URL`. Without a tunnel file they name `http://localhost:5173`, in
production too. The backend's CORS origin comes from the same function.

## The audit log

Writes made through the API record who did what in `audit_log`: user, catalog,
period, order, conversation, channel account, tenant and settings changes, and
the held-message and eligibility sweeps. Each row has the actor (`user:<id>` or
`cli:<os user>`), the tenant, the action and the resource. The writer is
[`platform/audit/logger.ts`](../apps/backend/src/platform/audit/logger.ts).

Admins read it at `/dashboard/admin/audit`, backed by `GET /api/admin/audit`. A
pinned admin sees their tenant. An unpinned operator also sees platform actions.

## Maintenance mode

Maintenance mode holds customer messages instead of answering them. It is the
setting `maintenance_mode`, at two levels:

- A tenant admin freezes their own business from `/dashboard/admin/settings`.
- A platform operator with no tenant selected freezes every business.

While a freeze is on, each inbound text is logged, stored in `held_messages` and
not answered. The webhook still answers Meta 200. Messages already in the inbox
before the freeze are still answered.

To release the held messages, turn the freeze off and press the button on the
settings page, or call:

```sh
curl -X POST -b "session=<token>" https://<frontend>/api/admin/process-held-messages
```

It answers 409 while the caller's scope is still frozen. Otherwise it answers
each held conversation through the normal turn, one grouped message per
conversation, and reports counts. An unpinned operator's sweep skips tenants
still frozen on their own. `GET /api/admin/held-messages-status` counts what is
held. The code is in
[`routes/admin/operations.ts`](../apps/backend/src/routes/admin/operations.ts)
and
[`conversation/process-held.ts`](../apps/backend/src/conversation/process-held.ts).

## When customers get no reply

| Check                                    | Where                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Webhooks arrive at all                   | the backend log: "Webhook POST rejected" or "refused" names signature, size or secret  |
| The number is `active`                   | `GET /api/admin/channels`                                                              |
| The tenant is not suspended or frozen    | `GET /api/tenants`, the settings page                                                  |
| The turn failed                          | the log line "Message processing failed", and the dev alert                            |
| The reply failed to send                 | `messages.status` `failed` or `queued`; the `outbox` row's `last_reason`               |
| The conversation is waiting on providers | phase `waiting_for_recovery`; see [Eligibility](./eligibility.md#outages-and-recovery) |
| The conversation is with a person        | phase `escalated`; the bot stays silent until release                                  |

Inbox rows a crash left `processing` are never answered again. Rows that ended
`failed` are never retried. Neither shows in the dashboard.

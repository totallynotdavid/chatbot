# Tenancy

One VendeYa deployment serves several businesses. Each business is a tenant. Its
conversations, catalog, orders and settings are its own, and its customers write
to its own WhatsApp numbers. The schema is in
[`db/schema.sql`](../apps/backend/src/db/schema.sql).

## Tenants

A tenant is a row in `tenants` with a slug, a name and a status, `active` or
`suspended`. Almost every other table carries `tenant_id`. A conversation is
keyed by `(tenant_id, channel_account_id, phone_number)`, so the same contact
has a separate conversation with each business and each number.

The seed creates one tenant, `totem`, with a sample catalog. A platform operator
creates any other:

```sh
curl -X POST -b "session=<token>" -H 'content-type: application/json' \
  -d '{"slug":"acme","name":"Acme"}' https://<frontend>/api/tenants
```

A new tenant has no catalog, no periods and no channel account. The dashboard
has no page for creating tenants.

## Users, memberships and roles

A user is one global account in `users`. A membership in `tenant_memberships`
joins a user to a tenant with one role:

| Role          | Adds                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| `admin`       | `/api/admin/*`: users, channel accounts, settings, audit, held messages   |
| `developer`   | catalog and period writes, reports, analytics, system logs, the simulator |
| `supervisor`  | catalog and period writes, reports, analytics, system logs                |
| `sales_agent` | nothing beyond the base                                                   |

The base is what every role can do: read the catalog, and read and work
conversations and orders. A `sales_agent` is narrowed: they list, open and act
on a conversation assigned to them or to nobody, never one assigned to another
agent, and they see the orders they created and the orders from their
conversations. Every other role sees the whole tenant. The rule is
`assignedAgentScope` in
[`platform/auth/scope.ts`](../apps/backend/src/platform/auth/scope.ts). Nothing
assigns a conversation when it escalates, so an agent reaches every conversation
no other agent has claimed. Order status changes allowed per role are in
[`routes/orders.ts`](../apps/backend/src/routes/orders.ts). Role checks are
`requireRole` in [`middleware/auth.ts`](../apps/backend/src/middleware/auth.ts)
and the route files.

Authorization reads the membership role. `users.role` is written when a user is
created and not read for authorization. A user can belong to several tenants
with a different role in each. Availability for new conversations
(`is_available`) is also per membership.

A tenant admin creates users in their own tenant from the dashboard
(`POST /api/admin/users`). A user's `phone_number` is where their personal
alerts go.

## Platform operators

A platform operator is VendeYa staff. The flag is `users.is_platform_operator`,
not a role. An operator acts as `admin` in every tenant and may act across
tenants. Only an operator can create a tenant, add a member to any tenant,
register a channel account, look up a DNI and change platform settings. Only an
operator can reset another operator's password or deactivate them, whatever
tenants that operator belongs to. The same holds for their membership. A tenant
admin cannot change an operator's role in their tenant or remove them from it,
and gets 403. The operator's powers live on the account, but a tenant admin
could still lock VendeYa staff out of that one tenant. An ordinary member is a
tenant matter, even one with other memberships.

Operators are made only from the command line:

```sh
bun run account create <username> --platform-operator
bun run account promote <username>
```

`create --platform-operator` makes an account with no membership. `promote`
keeps the memberships the account already has. See
[Operations](./operations.md#accounts).

## Sessions and the active tenant

Logging in creates a 30-day session and sets the `session` cookie
([`platform/auth/session.ts`](../apps/backend/src/platform/auth/session.ts)).
A request with fewer than 15 days left renews the session for 30 more and sets
the cookie again, so a session lasts 30 days from the last request that renewed
it. Other responses send no cookie.
The session carries `active_tenant_id`, the tenant it acts in. A member of
exactly one open tenant starts pinned to it. An operator, and a member of
several, starts unpinned and picks one:

```sh
curl -X POST -b "session=<token>" -H 'content-type: application/json' \
  -d '{"tenantId":"<id>"}' https://<frontend>/api/tenants/active
```

The dashboard does this from the tenant selector. The active tenant is the only
tenant input. No header or query parameter names a tenant.

Every request re-reads the membership, so a changed role or a removed membership
takes effect on the next request. Changing a role ends no session.

## How a read is scoped

`requireAuth` builds a scope for each request:
`{ userId, tenantId, membershipRole, isPlatformOperator }`
([`platform/auth/scope.ts`](../apps/backend/src/platform/auth/scope.ts)).

- A pinned caller reads only their tenant.
- An unpinned operator reads across every `active` tenant.
- An unpinned member is refused with 403 by `requireTenantScope`.
- A write needs a concrete tenant. `requireActiveTenant` refuses an unpinned
  caller, operator included.

Read functions take `tenantId: string | null` and filter with
`tenantPredicate(tenantId)` from
[`db/query.ts`](../apps/backend/src/db/query.ts). A concrete id filters to that
tenant. `null` means every open tenant, never every row. A row fetched by id is
checked with `canAccessTenant`, and another tenant's row answers 404, not 403.

Background workers read across tenants with `openTenantsOnly()` and
`activeChannelAccountsOnly()`, so a suspended business or a switched-off number
is skipped.

[`tests/tenant-scope-guard.test.ts`](../apps/backend/tests/tenant-scope-guard.test.ts)
fails when backend code builds a conditional tenant filter by hand, or when a
SELECT of a tenant-owned table names no tenant predicate in its function. Five
cross-tenant reads are exempt by name, such as the dedupe by Meta message id. It
does not check UPDATE or DELETE.

## Channel accounts

A channel account is one WhatsApp business number, a row in `channel_accounts`
([`domains/channels/accounts.ts`](../apps/backend/src/domains/channels/accounts.ts)).
Its key is Meta's `phone_number_id`, unique across every tenant. Its status is:

| Status     | Receives | Sends | Set by                                                    |
| ---------- | -------- | ----- | --------------------------------------------------------- |
| `pending`  | no       | no    | the default; an account with no access token              |
| `active`   | yes      | yes   | storing an access token on a pending account, or an admin |
| `disabled` | no       | no    | an admin                                                  |

An account cannot be made `active` without an access token. Messages for a
non-active number are dropped at the webhook. Messages already queued for it
wait until it is active again.

A platform operator registers a number (`POST /api/admin/channels`). A tenant
admin lists their tenant's numbers and replaces a token or sets the status of
one (`PATCH /api/admin/channels/:id`). Both are API-only; the dashboard has no
page for them. How to get the values from Meta is in
[Connecting WhatsApp](./whatsapp.md).

When a tenant has several numbers and the caller names none (the simulator, an
alert), the tenant's default is its oldest active account, then its oldest
pending one.

## Encrypted credentials

An account's access token and webhook verify token are stored in
`channel_secrets`, AES-256-GCM encrypted under `SECRETS_KEY`
([`platform/crypto/secrets.ts`](../apps/backend/src/platform/crypto/secrets.ts)).
The account row holds only a reference to each secret. Each ciphertext records a
`key_id`, the first 16 hex characters of the SHA-256 of the key, and a different
key cannot decrypt it.

`SECRETS_KEY` is 32 bytes, as 64 hex characters or as base64. It is read on
every use. Without it, a token cannot be stored: the seed leaves the account
`pending`, and the channels API answers 503. With the wrong key, stored tokens
cannot be read: sends fail with `no_token` while the account stays `active`.
There is no key rotation tool.

## How a webhook reaches a tenant

Meta's payload names the receiving number in
`entry[].changes[].value.metadata.phone_number_id`.
[`routes/webhook.ts`](../apps/backend/src/routes/webhook.ts) looks the id up in
`channel_accounts`. The account names the tenant. A batch that spans two tenants
delivers to both. One app secret, `WHATSAPP_APP_SECRET`, signs every number's
webhooks.

## Suspension

Setting `tenants.status` to `suspended` closes a business:

- its sessions lose their pin, and its members cannot pin it,
- the webhook drops its messages,
- the workers skip its queued messages and outbox rows,
- its customers get no sends,
- an operator's cross-tenant reads leave it out.

Alerts about it still go out. Nothing in the dashboard or the API suspends a
tenant. It is a SQL update, here through `bun:sqlite` from `apps/backend`:

```sh
cd apps/backend
bun --env-file=../../.env -e 'import { Database } from "bun:sqlite";
const db = new Database(process.env.DB_PATH ?? "./data/database.sqlite");
db.run("UPDATE tenants SET status = ? WHERE slug = ?", ["suspended", "acme"]);'
```

Setting the status back to `active` reopens it.

## The single-business migration

A database from before tenancy has a `conversations` table without `tenant_id`.
The first process to open it rebuilds it in one transaction
([`db/migrations.ts`](../apps/backend/src/db/migrations.ts)):

1. Rebuild each table in the new shape.
2. Create tenant `totem` and its channel account from `WHATSAPP_PHONE_ID`,
   `WHATSAPP_TOKEN` and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, through the same seed a
   fresh database runs.
3. Stamp every row with that tenant and account.
4. Make each legacy user a member of `totem` with their old role.
5. Copy legacy contract and call recordings into private storage.

Boot, `bun run seed` and `bun run account` all run it. It promotes nobody to
platform operator. If `WHATSAPP_PHONE_ID` is unset at that moment, the data
lands on a `pending` placeholder account named `unconfigured:<tenant id>`, and
setting the variable later creates a second account instead of moving the data.
Set it before the first boot on the new code.

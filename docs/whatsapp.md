# Connecting WhatsApp

Each business number is a channel account on a tenant (see
[Tenancy](./tenancy.md#channel-accounts)). Connecting one takes four values from
Meta and one registration call:

| Value                        | From Meta                                | Stored as                                 |
| ---------------------------- | ---------------------------------------- | ----------------------------------------- |
| Phone number id              | the number's id in the WhatsApp settings | `channel_accounts.phone_number_id`        |
| WhatsApp Business Account id | the account the number belongs to        | `channel_accounts.waba_id`                |
| Permanent access token       | a system user's token                    | encrypted in `channel_secrets`            |
| App secret                   | the Meta app's basic settings            | `WHATSAPP_APP_SECRET`, one per deployment |

The phone number id is not the phone number.

## Meta's side

These steps happen in Meta's consoles. This repository cannot check them, and
Meta changes them without notice. Meta's guide is at
<https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started>.

1. At <https://developers.facebook.com/apps>, create an app and add the use case
   "Connect with customers through WhatsApp".
2. In the app's WhatsApp settings, open "Manage phone numbers", add the business
   number and verify it. Note its phone number id and the WhatsApp Business
   Account id.
3. In Business Manager, <https://business.facebook.com/settings>, open Users >
   System users and create a system user with the admin role.
4. Assign the system user two assets, the app and the WhatsApp number, with full
   control of each.
5. On the system user, generate a token for the app, with no expiry and the
   WhatsApp permissions (`whatsapp_business_messaging`,
   `whatsapp_business_manage_events`). This is the permanent access token.
6. Copy the app secret from the app's basic settings.
7. Configure the webhook, as described below, once the channel account exists.

The backend calls one Graph endpoint with the token,
`POST https://graph.facebook.com/v17.0/<phone number id>/messages`, to send
replies and mark messages read
([`cloud-api.ts`](../apps/backend/src/adapters/whatsapp/cloud-api.ts)).

## Registering the number

An admin pinned to the tenant registers the number. `SECRETS_KEY` must be set on
the backend, or a request carrying a token answers 503.

```sh
bun scripts/generate-token.ts webhook    # prints a verify token
```

```sh
curl -X POST -b "session=<token>" -H 'content-type: application/json' \
  -d '{
    "phoneNumberId": "<phone number id>",
    "wabaId": "<whatsapp business account id>",
    "displayPhoneNumber": "+51 999 999 999",
    "label": "Ventas",
    "accessToken": "<permanent access token>",
    "verifyToken": "<verify token>"
  }' \
  https://<frontend>/api/admin/channels
```

The answer is the account, without its secrets. An account created with an
access token is `active` at once. A `phoneNumberId` another account holds
answers 409. The routes are in
[`routes/admin/channels.ts`](../apps/backend/src/routes/admin/channels.ts).

To list the tenant's numbers, replace a token, or switch a number off:

```sh
curl -b "session=<token>" https://<frontend>/api/admin/channels
curl -X PATCH -b "session=<token>" -H 'content-type: application/json' \
  -d '{"accessToken":"<new token>"}' https://<frontend>/api/admin/channels/<id>
curl -X PATCH -b "session=<token>" -H 'content-type: application/json' \
  -d '{"status":"disabled"}' https://<frontend>/api/admin/channels/<id>
```

`status` accepts `active`, `pending` and `disabled`. An account with no access
token cannot be made `active`.

The seed registers one number for the default tenant from the environment:
`WHATSAPP_PHONE_ID`, `WHATSAPP_TOKEN` and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
([`db/seeds/tenants.ts`](../apps/backend/src/db/seeds/tenants.ts)). It imports a
credential only when the account does not have one yet, so a token replaced
through the API survives the next seed. Every other number is registered through
the API.

## The callback URL

In the app's WhatsApp configuration, set the callback URL to the frontend's
public address followed by `/api/webhook`, exactly:

```text
https://<public host>/api/webhook
```

The frontend relays the request to the backend
([`routes/api/webhook/+server.ts`](../apps/frontend/src/routes/api/webhook/+server.ts)).
A trailing slash does not reach it: `/api/webhook/` answers a redirect.

Then subscribe the app to the number's `messages` webhook field. The backend
reads only the `messages` in a delivery and ignores delivery statuses.

## The verification handshake

When the callback URL is saved, Meta sends a GET with `hub.mode=subscribe`, a
`hub.verify_token` and a `hub.challenge`. The backend answers the challenge if
the token matches the verify token of any channel account, or
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Anything else answers 403. The handshake
carries no phone number id, so any stored verify token passes it.

```sh
curl "https://<public host>/api/webhook?hub.mode=subscribe&hub.verify_token=<verify token>&hub.challenge=42"
```

prints `42`.

## The webhook signature

Meta signs every delivery with the app secret, in the header
`X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`. The backend
checks it against `WHATSAPP_APP_SECRET` and answers 401 on a mismatch
([`routes/webhook.ts`](../apps/backend/src/routes/webhook.ts)). While the
variable is unset, every POST answers 503 and boot logs a warning. The GET
handshake does not need it.

The deployment holds one app secret, so every number it serves must deliver its
webhooks through the same Meta app.

A signed test delivery with no messages:

```sh
body='{"entry":[]}'
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" | sed 's/^.* //')
curl -X POST -H 'content-type: application/json' \
  -H "X-Hub-Signature-256: sha256=$sig" -d "$body" \
  https://<public host>/api/webhook
```

prints `{"status":"received"}`.

## Body size

Meta documents webhook payloads of up to 3 MB. Two limits apply:

- The backend refuses a body over 3 MiB with 413, before it checks the
  signature.
- The built frontend server refuses a body over `BODY_SIZE_LIMIT`. Its default
  is 512K, read by svelte-adapter-bun. Set it to `3M` in production, as
  `.env.production.example` does. `vite dev` does not apply it.

A refused delivery is not stored.

## Testing locally through a tunnel

```sh
bun run dev:tunnel
```

starts a cloudflared quick tunnel to `http://localhost:5173`
([`scripts/tunnel.ts`](../scripts/tunnel.ts)), prints its
`https://<name>.trycloudflare.com` address and writes it to `.cloudflare-url` at
the repository root. Use `<address>/api/webhook` as the callback URL. Set
`TUNNEL_TARGET_URL` to point the tunnel elsewhere.

While `.cloudflare-url` exists, image links in replies use the tunnel address
instead of `PUBLIC_URL`, and so do alert links and the backend's CORS origin.
The backend reads the file for CORS once, at boot.

```sh
bun run dev:tunnel:reset
```

stops every `cloudflared` process on the machine, not only this tunnel, and
deletes the file. Stopping the tunnel with Ctrl-C leaves the file behind, and
the links keep naming a dead address until it is deleted.

With `NODE_ENV=development`, replies go out through the notifier's linked
WhatsApp account, not the Cloud API. A tunnel test therefore receives through
Meta and replies from a different number. Run the backend with another
`NODE_ENV` to send through the Cloud API.

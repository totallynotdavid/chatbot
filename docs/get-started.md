# Get started

This takes a fresh clone to a bot you can talk to in the dashboard's simulator.
It needs no WhatsApp number, no Cálidda credentials and no LLM key.

## Prerequisites

- [mise](https://mise.jdx.dev), which installs the pinned bun, biome and
  cloudflared from [`mise.toml`](../mise.toml). A bun of the pinned version on
  your `PATH` works too.
- Chrome or Chromium, only if you run the notifier and want to send real
  messages in development.

## Install

```sh
git clone https://github.com/totallynotdavid/chatbot.git
cd chatbot
mise install
bun install
```

## The env file

```sh
cp .env.example .env
```

Every app reads the root `.env`. For the simulator, the defaults in
`.env.example` are enough. Variables already set in your shell win over the
file, so unset any `WHATSAPP_*`, `CALIDDA_*` or `POWERBI_*` you have exported
for another checkout.

Set `SECRETS_KEY` now. It encrypts each WhatsApp number's access token:

```sh
bun scripts/generate-token.ts secrets
```

prints a line such as `SECRETS_KEY="IiGTB0N-..."`. Put it in `.env`.

Without `SECRETS_KEY`, no access token can be stored. The seed leaves the
default number `pending`, the channels API refuses a token with 503, and nothing
can be sent to WhatsApp, through the Cloud API or the notifier. The simulator
still works, because it sends nothing. A different key later cannot read the
tokens stored under this one.

## The seed

```sh
bun run seed
```

creates `apps/backend/data/database.sqlite` with the default tenant `totem`, a
sample catalog with images, and a few test conversations. With no
`WHATSAPP_PHONE_ID` in `.env`, the tenant's number is a `pending` placeholder.
The seed is safe to run again, and the backend also runs it on every boot.

## The first account

The seed creates no user. Create an admin of `totem`:

```sh
bun run account create admin
```

It asks for a password twice, at least 12 characters. To also act across
tenants, create a platform operator:

```sh
bun run account create ops --platform-operator
```

[Operations](./operations.md#accounts) has every form of the command.

## Run it

```sh
bun run dev
```

starts three processes. The backend and the frontend restart on change:

| Process  | Address                 | Role                                                |
| -------- | ----------------------- | --------------------------------------------------- |
| backend  | `http://localhost:3000` | the API, the workers and the bot                    |
| frontend | `http://localhost:5173` | the dashboard                                       |
| notifier | `http://localhost:3001` | development sends through a linked WhatsApp account |

The notifier prints a QR code. Scan it from WhatsApp to link an account if you
want development sends to reach a real phone. The simulator does not need it.
`bun run dev:backend`, `dev:frontend` and `dev:notifier` start one at a time.

On a fresh setup the backend warns that `WHATSAPP_APP_SECRET` is unset, and,
unless you created one, that no platform operator exists. Neither affects the
simulator.

## Talk to the bot

1. Open <http://localhost:5173> and log in as `admin`.
2. Open the Simulador tile.
3. Start a new simulation ("Nueva simulación") and pick the persona "FNB -
   Crédito Alto (S/ 8000)". A persona answers the eligibility check in place of
   Cálidda.
4. Write `hola`, then `si`, then any DNI such as `12345678`.

The bot greets you as Cálidda, asks whether the gas service is in your name,
asks for your DNI, then offers S/ 8000 of credit and lists the product groups:

```text
hola      -> Hola 👋 Somos Cálidda. El servicio de gas está a tu nombre?
si        -> Excelente 😊. Necesito tu DNI para consultar tu línea de crédito.
12345678  -> Perfecto Maria 🎉 Calificas con S/ 8000.00 de línea.
             Tengo Línea blanca y hogar, Tecnología, Combos. ¿Qué te gustaría ver?
```

The wording varies between runs. Answer with a group, such as `Tecnología`, then
a category it lists, such as `celulares`, to get up to three products as images.

For each simulated message the backend logs "Refusing to send on a channel
account that is not active". It comes from marking the message read on the
`pending` placeholder number, and changes nothing.

The same conversation through the API, with the frontend running:

```sh
curl -c cookies.txt -H 'content-type: application/json' \
  -d '{"username":"admin","password":"<password>"}' \
  http://localhost:5173/api/auth/login
curl -b cookies.txt -H 'content-type: application/json' \
  -d '{"phoneNumber":"51900000001","personaId":"fnb_high_credit"}' \
  http://localhost:5173/api/simulator/conversations
for m in hola si 12345678; do
  curl -b cookies.txt -H 'content-type: application/json' \
    -d "{\"phoneNumber\":\"51900000001\",\"message\":\"$m\"}" \
    http://localhost:5173/api/simulator/message
done
curl -b cookies.txt http://localhost:5173/api/simulator/conversation/51900000001
```

Without `OPENAI_API_KEY`, a message the bot's patterns do not recognize gets no
reply, and the backend logs "Message processing failed". Set the key in `.env`
to let the bot answer questions and recover from unclear replies.

## Next

- [How a conversation runs](./conversation.md) explains what just happened.
- [Connecting WhatsApp](./whatsapp.md) connects a real number.
- [Development](./development.md) lists the checks to run before a change.

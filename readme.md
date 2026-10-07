# VendeYa

VendeYa is a managed WhatsApp sales service for businesses in Lima. A customer
writes to the business's WhatsApp number, the bot checks credit eligibility and
shows catalog items, and the business's sales team takes over to close the sale.

The current flow is shared by every tenant and is built for appliances sold on
Cálidda credit. VendeYa staff create and operate each tenant. The bot handles
text messages and catalog images. It does not take payment, arrange delivery, or
process inbound images, audio, or other non-text messages.

## Install

The local setup needs [mise](https://mise.jdx.dev) and Bun. From a fresh clone:

```sh
mise install
bun install
cp .env.example .env
bun run seed
bun run account create admin
bun run dev
```

Open <http://localhost:5173>, log in as `admin`, and open the Simulador. Start a
simulation with the persona `FNB - Crédito Alto (S/ 8000)`, then send `hola`,
`si`, and an eight-digit DNI such as `12345678`. The simulator needs no WhatsApp
number, provider credentials, or LLM key. The full setup and real number
instructions are in [Get started](./docs/get-started.md).

## Features

- A fixed Cálidda credit-eligibility flow backed by FNB and GASO providers.
- Tenant-specific catalogs, bundles, conversations, orders, and staff roles.
- A dashboard for conversations, catalog and order work, reports, and a provider
  lookup for platform operators.
- A simulator with built-in personas for testing the conversation flow.
- WhatsApp Cloud API sends in production and a linked WhatsApp Web notifier in
  development.
- An outbox that retries recoverable send failures and hands undeliverable
  replies to a person.

## Read next

- The [manual](./docs/readme.md) is the ordered guide for setup, operations,
  WhatsApp, tenancy, and development.
- [Architecture](./docs/architecture.md) maps workspaces, request flow, state,
  and code ownership.
- [Contributing](./.github/contributing.md) is the contributor entry point.

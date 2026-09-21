# VendeYa

VendeYa is a managed WhatsApp sales service for businesses in Lima. A customer
writes to the business's WhatsApp number, a bot qualifies them, and the
business's sales team closes the sale. Staff work the conversations, the catalog
and the orders in a web dashboard.

Today the bot runs one flow, built for businesses that sell appliances on credit
from Cálidda, the city's gas distributor. It checks the customer's DNI with
Cálidda, tells them how much credit they have, shows the products they can
afford, and hands a customer who picks one to the sales team, who call to close
the sale. That flow's eligibility rules and much of its copy are shared by every
tenant.

VendeYa's own staff run the service for each business. It is not a self-serve
bot builder: VendeYa's staff create each business, and a business cannot change
what the bot says or how it decides. The bot does not close a sale, take a
payment or arrange a delivery. It answers text only, and ignores images, audio
and other message types.

```sh
mise install && bun install
cp .env.example .env
bun run seed
bun run account create admin
bun run dev
```

Then open <http://localhost:5173>, log in as `admin`, and talk to the bot in the
Simulador with a test persona. It needs no WhatsApp number and no credentials.
[Get started](./docs/get-started.md) walks through each step.

The [manual](./docs/readme.md) covers running, connecting and operating VendeYa.
The [architecture](./architecture.md) maps the code for contributors.

# The dashboard

The dashboard is the SvelteKit app in [`apps/frontend`](../apps/frontend/). A
business's staff use it to work conversations, edit the catalog and follow
orders. Its UI text is Spanish.

## How it reaches the backend

The browser talks only to the frontend. Three routes forward to the backend at
`http://localhost:3000`, a literal in
[`packages/utils/src/url.ts`](../packages/utils/src/url.ts), so the frontend and
the backend run on one host:

| Route                                                                                         | Forwards                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`routes/api/[...path]/+server.ts`](../apps/frontend/src/routes/api/[...path]/+server.ts)     | `/api/*` with every request header, the `session` cookie included, and returns the backend's response and headers, `Set-Cookie` included |
| [`routes/media/[...path]/+server.ts`](../apps/frontend/src/routes/media/[...path]/+server.ts) | `/media/*`, the public catalog images, with a one-week cache header                                                                      |
| [`routes/api/webhook/+server.ts`](../apps/frontend/src/routes/api/webhook/+server.ts)         | Meta's webhook. See [Connecting WhatsApp](./whatsapp.md)                                                                                 |

The `/api` proxy forwards the request body as bytes, so a binary upload (a
bundle image, a contract PDF, a call recording) reaches the backend as the
browser sent it. It holds the whole body in memory. The built frontend refuses a
body over `BODY_SIZE_LIMIT` before the proxy sees it
([Operations](./operations.md)).

Components call the API with `fetchApi` from
[`lib/utils/api.ts`](../apps/frontend/src/lib/utils/api.ts), a thin `fetch`
wrapper that throws `ApiError` with the backend's `error` text on a non-2xx.
Server loads use SvelteKit's `fetch` and copy the `session` cookie into the
request by hand:

```ts
// routes/dashboard/catalog/+page.server.ts
export const load: PageServerLoad = async ({ cookies, url, fetch }) => {
  const sessionToken = cookies.get("session");
  // ...
  const headers = { cookie: `session=${sessionToken}` };
  const periodsRes = await fetch("/api/periods", { headers });
```

A load must use the `fetch` it is given. The global `fetch` cannot resolve a
relative `/api/...` URL on the server and throws. Most loads catch the error and
return empty data, so the page renders as if there were nothing to show.

## How auth state decides what renders

Sessions live on the backend. On every request,
[`hooks.server.ts`](../apps/frontend/src/hooks.server.ts) sends the `session`
cookie to `GET /api/auth/me` and puts the answer in `locals.user`. A request for
any `/dashboard` path without a valid session is redirected to `/login`.

On the client, the `auth` object in
[`lib/state/auth.svelte.ts`](../apps/frontend/src/lib/state/auth.svelte.ts)
holds the user, their role, the active tenant and the tenant list. The root
layout fills it in `onMount`, so the server renders every page as signed out and
role-dependent parts appear after hydration. Its getters (`isAdmin`,
`canEditCatalog`, `canAccessSimulator`, `canAccessProviders` and the rest)
decide which tiles and buttons show.

Role lists live in three places: the `auth` getters, the page guards, and the
backend's `requireRole`. Nothing keeps them equal. The backend's check is the
one that holds.

These pages check the role on the server:

- [`dashboard/admin/+layout.server.ts`](../apps/frontend/src/routes/dashboard/admin/+layout.server.ts)
  sends anyone but `admin` to `/dashboard`.
- `reports/+page.server.ts` allows `admin`, `developer`, `supervisor`.
- `simulator/+page.server.ts` and `personas/+page.server.ts` allow `admin`,
  `developer`.

Other pages have no role guard. When the backend refuses their load with 403,
the load returns empty data.

The tenant selector sits in
[`dashboard-nav.svelte`](../apps/frontend/src/lib/components/shared/dashboard-nav.svelte).
It calls `POST /api/tenants/active` and reloads the page. The nav bar, and so
the selector, is not shown on `/dashboard` itself.

## Route layout

```text
routes/
  +page.svelte                      sends to /dashboard or /login
  login/                            sign-in form
  dashboard/
    +page.svelte                    home: a grid of tiles
    +layout.svelte                  nav bar and breadcrumbs, except on home
    conversations/  [phone]/        inbox and one conversation
    catalog/  bundles/[id]/  inventory/[id]/
    orders/  [orderId]/
    reports/                        admin, developer, supervisor
    activity/                       system activity
    simulator/                      admin, developer
    personas/  create/              admin, developer
    providers/                      DNI lookup, platform operators
    admin/                          admin only
      users/  [userId]/  create/
      periods/  audit/  settings/
  api/[...path]/  api/webhook/  media/[...path]/
```

## Adding a page

A page under `dashboard/` needs four things:

1. **A route.** `routes/dashboard/<area>/+page.svelte`, and a `+page.server.ts`
   if it loads data on the server. If only some roles may see it, check
   `locals.user.role` there and `redirect(303, "/dashboard")`.
2. **A tile.** A `DashboardGridItem` in
   [`dashboard/+page.svelte`](../apps/frontend/src/routes/dashboard/+page.svelte),
   wrapped in `{#if auth.<getter>}` for a restricted page. Without it nothing
   links to the page.
3. **A nav label.** An entry in `breadcrumbLabels` in
   [`dashboard-nav.svelte`](../apps/frontend/src/lib/components/shared/dashboard-nav.svelte).
   Without it the page gets no breadcrumb.
4. **A title.** `<PageTitle title="..." />` from
   [`page-title.svelte`](../apps/frontend/src/lib/components/shared/page-title.svelte).

The backend route it calls needs its own `requireRole`. The page guard only
hides the page.

Conventions the pages follow:

- Svelte 5 runes: `$props()` with a `Props` type, `$state`, `$derived`, callback
  props, snippets.
- Mutations are client-side `fetchApi` calls with feedback through `toast` from
  [`lib/state/toast.svelte.ts`](../apps/frontend/src/lib/state/toast.svelte.ts).
  No page uses form actions.
- Dates and money go through
  [`lib/utils/formatters.ts`](../apps/frontend/src/lib/utils/formatters.ts),
  which formats for `es-PE` in `America/Lima`. Prices are written
  `S/ {formatPrice(x)}`.
- Styling is Tailwind v4 utility classes, with colour tokens in
  [`lib/styles/tokens.css`](../apps/frontend/src/lib/styles/tokens.css).
- Shared UI pieces are in
  [`lib/components/ui/`](../apps/frontend/src/lib/components/ui/).

## The Proveedores page

The page calls `GET /api/providers/:dni` and shows the `result` in the answer.
`result` is what
[`mapper.ts`](../apps/backend/src/domains/eligibility/mapper.ts) builds: a
`status` (`eligible`, `not_eligible`, `system_outage` or `needs_human`) and, for
an approval, `segment`, `credit`, `name` and `nse`. Only an approval carries a
credit line. When the check itself failed, `result` is `{ error }`. The answer
does not say which provider replied, so the page shows the segment.

The two dots in the page header come from `providersChecked` in the same answer:
the providers whose circuit breaker was closed for that lookup. They appear
after the first lookup. The dashboard cannot reach `/health`, which the proxy
does not forward.

## Editing the catalog

The bundle editor saves with `PATCH /api/catalog/bundles/:id`, and the stock
badge on a bundle card sends `stock_status` to the same route. The route stores
`name`, `price`, `is_active`, `stock_status`, `notes`, `primary_category`,
`composition_json` and `installments_json`, and ignores any other key.

The category must be a non-empty string. Each JSON column must be a string that
parses to an object or an array. The bot parses both on every catalog read, so
the create route holds them to the same rule. A value that fails answers 400 and
changes nothing.

## What has no page

The API has endpoints the dashboard does not reach: creating tenants, adding
members to a tenant, registering channel accounts, retrying eligibility, the
analytics endpoints. [Tenancy](./tenancy.md),
[Connecting WhatsApp](./whatsapp.md) and [Eligibility](./eligibility.md) show
the ones an operator needs as `curl` commands.

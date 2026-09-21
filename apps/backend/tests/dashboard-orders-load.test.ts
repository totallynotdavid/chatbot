/**
 * The dashboard's Orders page loads its rows on the server. The load has to use
 * the `fetch` SvelteKit hands it, because the global one cannot resolve a
 * relative `/api/...` URL.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";

import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { requireAuth } from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import { createOrder } from "../src/domains/orders/write.ts";
import orderRoutes from "../src/routes/orders.ts";

// Loaded by a computed path: the SvelteKit file is outside this project's tsc
// rootDir and imports generated ./$types.
const LOAD_PATH = "../../frontend/src/routes/dashboard/orders/+page.server.ts";
const { load } = (await import(LOAD_PATH)) as {
  load: (event: {
    url: URL;
    cookies: { get: (name: string) => string | undefined };
    fetch: typeof fetch;
  }) => Promise<{ orders: Array<{ id: string }>; metrics: unknown }>;
};

const CUSTOMER = "51900777888";

describe("the orders page load", () => {
  let app: Hono;
  let tenant: TenantFixture;
  let token: string;
  let orderId: string;

  /** What SvelteKit passes to `load`: a relative URL is answered in-process. */
  const kitFetch = ((input: string | URL | Request, init?: RequestInit) =>
    app.request(String(input), init)) as typeof fetch;

  const cookies = { get: (name: string) => (name === "session" ? token : "") };
  const pageUrl = (query = "") =>
    new URL(`http://dashboard.test/dashboard/orders${query}`);

  beforeEach(() => {
    applySchema();
    app = new Hono();
    app.use("/api/*", requireAuth);
    app.route("/api/orders", orderRoutes);
    app.onError(errorHandler);

    tenant = createTenantFixture("orders-load");
    insertConversation(tenant.ref(CUSTOMER), { clientName: "Ana" });
    orderId = createOrder({
      ref: tenant.ref(CUSTOMER),
      clientName: "Ana",
      clientDni: "12345678",
      products: [{ productId: "p1", price: 10, quantity: 1 }],
      totalAmount: 10,
      deliveryAddress: "Av. Lima 123",
    }).id;

    const { userId } = createMember(tenant, "admin");
    token = generateSessionToken();
    createSession(token, userId, tenant.tenantId);
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  it("returns the tenant's orders and metrics", async () => {
    const data = await load({ url: pageUrl(), cookies, fetch: kitFetch });

    expect(data.orders.map((o) => o.id)).toEqual([orderId]);
    expect(data.metrics).not.toBeNull();
  });

  it("passes the filters from the page URL to the API", async () => {
    const pending = await load({
      url: pageUrl("?status=pending"),
      cookies,
      fetch: kitFetch,
    });
    const delivered = await load({
      url: pageUrl("?status=delivered"),
      cookies,
      fetch: kitFetch,
    });

    expect(pending.orders.map((o) => o.id)).toEqual([orderId]);
    expect(delivered.orders).toEqual([]);
  });

  it("returns nothing without a session", async () => {
    const data = await load({
      url: pageUrl(),
      cookies: { get: () => undefined },
      fetch: kitFetch,
    });

    expect(data).toEqual({ orders: [], metrics: null });
  });
});

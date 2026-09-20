/** The orders list cuts its date filter in America/Lima days and answers a bad date with 400. */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  setSystemTime,
} from "bun:test";
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

const CUSTOMER = "51900555666";

describe("orders list date filter", () => {
  let app: Hono;
  let tenant: TenantFixture;
  let auth: { Cookie: string };

  const get = (query: string) =>
    app.request(`/api/orders?${query}`, { headers: auth });

  /** Files an order under the instant it was created, by moving the clock for the insert. */
  function orderCreatedAt(iso: string): string {
    setSystemTime(new Date(iso));
    try {
      return createOrder({
        ref: tenant.ref(CUSTOMER),
        clientName: "Ana",
        clientDni: "12345678",
        products: [{ productId: "p1", price: 10, quantity: 1 }],
        totalAmount: 10,
        deliveryAddress: "Av. Lima 123",
      }).id;
    } finally {
      setSystemTime();
    }
  }

  async function idsFor(query: string): Promise<string[]> {
    const response = await get(query);
    expect(response.status).toBe(200);
    return ((await response.json()) as Array<{ id: string }>).map((o) => o.id);
  }

  beforeEach(() => {
    applySchema();
    app = new Hono();
    app.use("/api/*", requireAuth);
    app.route("/api/orders", orderRoutes);
    app.onError(errorHandler);

    tenant = createTenantFixture("orders-dates");
    insertConversation(tenant.ref(CUSTOMER), { clientName: "Ana" });

    const { userId } = createMember(tenant, "admin");
    const token = generateSessionToken();
    createSession(token, userId, tenant.tenantId);
    auth = { Cookie: `session=${token}` };
  });

  afterEach(() => {
    setSystemTime();
    dropTenantFixture(tenant);
  });

  it("files an order made at 21:00 Lima on the 20th under the 20th", async () => {
    const id = orderCreatedAt("2026-09-21T02:00:00Z");

    expect(await idsFor("startDate=2026-09-20&endDate=2026-09-20")).toEqual([
      id,
    ]);
    expect(await idsFor("startDate=2026-09-21&endDate=2026-09-21")).toEqual([]);
  });

  it("closes the Lima day at 04:59:59.999Z and opens the next at 05:00:00.000Z", async () => {
    const lastOfTheDay = orderCreatedAt("2026-09-21T04:59:59.999Z");
    const firstOfTheNext = orderCreatedAt("2026-09-21T05:00:00.000Z");

    expect(await idsFor("startDate=2026-09-20&endDate=2026-09-20")).toEqual([
      lastOfTheDay,
    ]);
    expect(await idsFor("startDate=2026-09-21&endDate=2026-09-21")).toEqual([
      firstOfTheNext,
    ]);
  });

  it("takes each bound on its own", async () => {
    const early = orderCreatedAt("2026-09-19T15:00:00Z");
    const late = orderCreatedAt("2026-09-22T15:00:00Z");

    expect(await idsFor("startDate=2026-09-22")).toEqual([late]);
    expect(await idsFor("endDate=2026-09-19")).toEqual([early]);
  });

  it("takes an ISO timestamp with a zone as the exact instant", async () => {
    const before = orderCreatedAt("2026-09-21T02:00:00Z");
    const at = orderCreatedAt("2026-09-21T02:00:01Z");

    expect(await idsFor("startDate=2026-09-21T02:00:01Z")).toEqual([at]);
    expect(await idsFor("startDate=2026-09-20T21:00:01-05:00")).toEqual([at]);
    expect(await idsFor("endDate=2026-09-21T02:00:00Z")).toEqual([before]);
  });

  it("answers 400 for a value that is not a date", async () => {
    for (const [query, message] of [
      [
        "startDate=garbage",
        "startDate must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
      [
        "endDate=garbage",
        "endDate must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
      [
        "startDate=2026-02-30",
        "startDate must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
      [
        "startDate=2026-09-20T10:00:00",
        "startDate must be YYYY-MM-DD or an ISO timestamp with a zone",
      ],
    ] as const) {
      const response = await get(query);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: message });
    }
  });

  it("does not filter on an empty date", async () => {
    const id = orderCreatedAt("2026-09-21T02:00:00Z");

    expect(await idsFor("startDate=&endDate=")).toEqual([id]);
  });
});

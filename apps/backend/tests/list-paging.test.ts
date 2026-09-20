/** The six list routes read `limit` (and orders `offset`) through one reader that refuses anything but a plain in-range integer. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { requireAuth, requireRole } from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import { logAction } from "../src/platform/audit/logger.ts";
import adminRoutes from "../src/routes/admin.ts";
import analyticsRoutes from "../src/routes/analytics.ts";
import orderRoutes from "../src/routes/orders.ts";
import systemLogRoutes from "../src/routes/system-logs.ts";

const CUSTOMER = "51900777888";
const LIMIT_MESSAGE = "limit must be a whole number from 1 to 500";
const OFFSET_MESSAGE = "offset must be a whole number of 0 or more";

type Route = {
  name: string;
  path: string;
  fallback: number;
  seed(tenant: TenantFixture, userId: string, count: number): void;
  count(body: unknown): number;
};

function seedLlmCalls(
  tenant: TenantFixture,
  count: number,
  status: "success" | "error",
): void {
  const insert = db.prepare(
    `INSERT INTO llm_calls
       (id, tenant_id, channel_account_id, phone_number, operation, model,
        prompt, user_message, status, error_message, latency_ms)
     VALUES (?, ?, ?, ?, 'classify', 'test-model', 'p', 'm', ?, 'boom', 5)`,
  );
  for (let i = 0; i < count; i++) {
    insert.run(
      crypto.randomUUID(),
      tenant.tenantId,
      tenant.channelAccountId,
      CUSTOMER,
      status,
    );
  }
}

const ROUTES: Route[] = [
  {
    name: "orders",
    path: "/api/orders",
    fallback: 50,
    seed(tenant, _userId, count) {
      const insert = db.prepare(
        `INSERT INTO orders
           (id, tenant_id, channel_account_id, order_number, conversation_phone,
            client_name, client_dni, products, total_amount, delivery_address,
            status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'Ana', '12345678', '[]', 10, 'Av. Lima 123',
                 'pending', ?, ?)`,
      );
      for (let i = 0; i < count; i++) {
        insert.run(
          crypto.randomUUID(),
          tenant.tenantId,
          tenant.channelAccountId,
          `ORD-TEST-${i}`,
          CUSTOMER,
          Date.now() + i,
          Date.now() + i,
        );
      }
    },
    count: (body) => (body as unknown[]).length,
  },
  {
    name: "analytics events",
    path: "/api/analytics/events",
    fallback: 50,
    seed(tenant, _userId, count) {
      const insert = db.prepare(
        `INSERT INTO analytics_events
           (id, tenant_id, channel_account_id, phone_number, event_type)
         VALUES (?, ?, ?, ?, 'session_start')`,
      );
      for (let i = 0; i < count; i++) {
        insert.run(
          crypto.randomUUID(),
          tenant.tenantId,
          tenant.channelAccountId,
          CUSTOMER,
        );
      }
    },
    count: (body) => (body as { events: unknown[] }).events.length,
  },
  {
    name: "system logs",
    path: "/api/system/logs",
    fallback: 100,
    seed: (tenant, _userId, count) => seedLlmCalls(tenant, count, "success"),
    count: (body) => (body as { logs: unknown[] }).logs.length,
  },
  {
    name: "llm errors",
    path: "/api/admin/llm-errors",
    fallback: 100,
    seed: (tenant, _userId, count) => seedLlmCalls(tenant, count, "error"),
    count: (body) => (body as { errors: unknown[] }).errors.length,
  },
  {
    name: "llm calls",
    path: "/api/admin/llm-calls",
    fallback: 50,
    seed: (tenant, _userId, count) => seedLlmCalls(tenant, count, "success"),
    count: (body) => (body as { calls: unknown[] }).calls.length,
  },
  {
    name: "audit",
    path: "/api/admin/audit",
    fallback: 100,
    seed(tenant, userId, count) {
      for (let i = 0; i < count; i++) {
        logAction({ userId, tenantId: tenant.tenantId }, `test.${i}`, "thing");
      }
    },
    count: (body) => (body as { logs: unknown[] }).logs.length,
  },
];

describe("limit and offset on the list routes", () => {
  let app: Hono;
  let tenant: TenantFixture;
  let userId: string;
  let auth: { Cookie: string };

  const get = (path: string, query: string) =>
    app.request(`${path}?${query}`, { headers: auth });

  beforeEach(() => {
    applySchema();
    app = new Hono();
    app.use("/api/*", requireAuth);
    app.route("/api/orders", orderRoutes);
    app.use("/api/analytics/*", requireRole("admin"));
    app.route("/api/analytics", analyticsRoutes);
    app.use("/api/system/logs/*", requireRole("admin"));
    app.route("/api/system/logs", systemLogRoutes);
    app.use("/api/admin/*", requireRole("admin"));
    app.route("/api/admin", adminRoutes);
    app.onError(errorHandler);

    tenant = createTenantFixture("list-paging");
    insertConversation(tenant.ref(CUSTOMER), { clientName: "Ana" });

    ({ userId } = createMember(tenant, "admin"));
    const token = generateSessionToken();
    createSession(token, userId, tenant.tenantId);
    auth = { Cookie: `session=${token}` };
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  describe.each(ROUTES)("$name", (route) => {
    it.each([
      "garbage",
      "-1",
      "0",
      "1.5",
      "1e2",
      "501",
      "+5",
      "12abc",
      "0x10",
      "%205",
      "99999999999999999999",
    ])("answers 400 for limit=%s", async (value) => {
      const response = await get(route.path, `limit=${value}`);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: LIMIT_MESSAGE });
    });

    it("takes limit=1 and limit=500", async () => {
      route.seed(tenant, userId, route.fallback + 1);

      const one = await get(route.path, "limit=1");
      expect(one.status).toBe(200);
      expect(route.count(await one.json())).toBe(1);

      const most = await get(route.path, "limit=500");
      expect(most.status).toBe(200);
      expect(route.count(await most.json())).toBeGreaterThan(route.fallback);
    });

    it("uses the route's own default for an absent or empty limit", async () => {
      route.seed(tenant, userId, route.fallback + 1);

      for (const query of ["", "limit="]) {
        const response = await get(route.path, query);

        expect(response.status).toBe(200);
        expect(route.count(await response.json())).toBe(route.fallback);
      }
    });
  });

  describe("orders offset", () => {
    const orders = ROUTES[0]!;

    it.each(["garbage", "-1", "1.5", "1e2", "+1", "0x10", "9007199254740992"])(
      "answers 400 for offset=%s",
      async (value) => {
        const response = await get(orders.path, `offset=${value}`);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: OFFSET_MESSAGE });
      },
    );

    it("skips that many rows, and reads an absent, empty or zero offset as none", async () => {
      orders.seed(tenant, userId, 3);

      for (const [query, expected] of [
        ["offset=1", 2],
        ["offset=3", 0],
        ["offset=0", 3],
        ["offset=", 3],
        ["", 3],
      ] as const) {
        const response = await get(orders.path, query);

        expect(response.status).toBe(200);
        expect(orders.count(await response.json())).toBe(expected);
      }
    });
  });
});

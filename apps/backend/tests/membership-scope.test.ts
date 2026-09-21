/**
 * A caller acts only inside the tenant scope their membership grants, and only
 * a platform operator acts on a platform operator. Each case runs through the
 * real routers and a real session cookie, mounted the way `src/index.ts`
 * mounts them.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import process from "node:process";
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
import conversationRoutes from "../src/routes/conversations.ts";
import orderRoutes from "../src/routes/orders.ts";
import adminUserRoutes from "../src/routes/admin/users.ts";
import adminChannelRoutes from "../src/routes/admin/channels.ts";
import { createOrder } from "../src/domains/orders/write.ts";
import { takeoverConversation } from "../src/domains/conversations/write.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";

type Auth = { cookie: string };

function buildApp() {
  const app = new Hono();
  app.use("/api/*", requireAuth);
  app.route("/api/conversations", conversationRoutes);
  app.route("/api/orders", orderRoutes);
  app.use("/api/admin/*", requireRole("admin"));
  app.route("/api/admin/users", adminUserRoutes);
  app.route("/api/admin/channels", adminChannelRoutes);
  app.onError(errorHandler);
  return app;
}

function login(userId: string, tenantId: string | null): Auth {
  const token = generateSessionToken();
  createSession(token, userId, tenantId);
  return { cookie: `session=${token}` };
}

/** A platform operator, optionally keeping one membership as `promote` does. */
function createOperator(fixture?: TenantFixture): string {
  if (fixture) {
    const { userId } = createMember(fixture, "admin");
    db.prepare("UPDATE users SET is_platform_operator = 1 WHERE id = ?").run(
      userId,
    );
    return userId;
  }

  const userId = `u-${crypto.randomUUID()}`;
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, name, is_platform_operator)
     VALUES (?, ?, 'x', 'admin', 'Operator', 1)`,
  ).run(userId, `op-${userId.slice(2, 12)}`);
  return userId;
}

function accountOf(userId: string) {
  return db
    .prepare("SELECT password_hash, is_active FROM users WHERE id = ?")
    .get(userId) as { password_hash: string; is_active: number };
}

describe("membership scope", () => {
  let app: ReturnType<typeof buildApp>;
  let alpha: TenantFixture;
  let beta: TenantFixture;
  let alphaAdmin: Auth;

  beforeEach(() => {
    applySchema();
    app = buildApp();
    alpha = createTenantFixture("alpha-scope");
    beta = createTenantFixture("beta-scope");
    alphaAdmin = login(createMember(alpha, "admin").userId, alpha.tenantId);
  });

  afterEach(() => {
    dropTenantFixture(alpha);
    dropTenantFixture(beta);
  });

  function request(
    method: string,
    path: string,
    auth: Auth,
    body?: unknown,
  ): Promise<Response> {
    return Promise.resolve(
      app.request(path, {
        method,
        headers: {
          Cookie: auth.cookie,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  describe("a platform operator's account", () => {
    const resetPassword = (auth: Auth, userId: string) =>
      request("POST", `/api/admin/users/${userId}/password`, auth, {
        newPassword: "a-new-password",
      });
    const toggleStatus = (auth: Auth, userId: string) =>
      request("PATCH", `/api/admin/users/${userId}/status`, auth);

    it("cannot have its password reset by a tenant admin of their tenant", async () => {
      const operator = createOperator(alpha);
      const before = accountOf(operator);

      const response = await resetPassword(alphaAdmin, operator);

      expect(response.status).toBe(403);
      expect(accountOf(operator)).toEqual(before);
    });

    it("cannot be deactivated by a tenant admin of their tenant", async () => {
      const operator = createOperator(alpha);

      const response = await toggleStatus(alphaAdmin, operator);

      expect(response.status).toBe(403);
      expect(accountOf(operator).is_active).toBe(1);
    });

    it("can still be changed by another platform operator", async () => {
      const target = createOperator(alpha);
      const actor = login(createOperator(), alpha.tenantId);
      const before = accountOf(target);

      expect((await resetPassword(actor, target)).status).toBe(200);
      expect(accountOf(target).password_hash).not.toBe(before.password_hash);

      expect((await toggleStatus(actor, target)).status).toBe(200);
      expect(accountOf(target).is_active).toBe(0);
    });

    it("leaves the cross-tenant refusal as it was", async () => {
      const { userId: shared } = createMember(alpha, "sales_agent");
      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'sales_agent')`,
      ).run(crypto.randomUUID(), beta.tenantId, shared);
      const before = accountOf(shared);

      for (const response of [
        await resetPassword(alphaAdmin, shared),
        await toggleStatus(alphaAdmin, shared),
      ]) {
        expect(response.status).toBe(403);
        expect(((await response.json()) as { error: string }).error).toContain(
          "belongs to other businesses",
        );
      }
      expect(accountOf(shared)).toEqual(before);
    });
  });

  describe("a sales agent", () => {
    /** Assigned to `owner`. */
    const OWNED = "51900777001";
    /** Assigned to nobody, as every escalated conversation is today. */
    const OPEN = "51900777003";
    let owner: string;
    let assigned: Auth;
    let other: Auth;
    let ownedOrderId: string;
    let openOrderId: string;

    // Filed the way the bot files one, with no agent on the order itself.
    // The link to the agent is the conversation the order came from.
    const fileOrder = (phone: string) =>
      createOrder({
        ref: alpha.ref(phone),
        clientName: "Cliente",
        clientDni: "12345678",
        products: [{ productId: "p1", name: "Terma", price: 900, quantity: 1 }],
        totalAmount: 900,
        deliveryAddress: "Av. Siempre Viva 123",
      }).id;

    beforeEach(() => {
      owner = createMember(alpha, "sales_agent").userId;
      assigned = login(owner, alpha.tenantId);
      other = login(createMember(alpha, "sales_agent").userId, alpha.tenantId);

      insertConversation(alpha.ref(OWNED), {
        clientName: "Cliente",
        assignedAgent: owner,
      });
      insertConversation(alpha.ref(OPEN), { clientName: "Sin asignar" });

      ownedOrderId = fileOrder(OWNED);
      openOrderId = fileOrder(OPEN);
    });

    const statusOf = (phone: string) =>
      (
        db
          .prepare(
            "SELECT status FROM conversations WHERE tenant_id = ? AND phone_number = ?",
          )
          .get(alpha.tenantId, phone) as { status: string }
      ).status;

    const orderIds = async (auth: Auth) =>
      (
        (await (await request("GET", "/api/orders", auth)).json()) as Array<{
          id: string;
        }>
      ).map((o) => o.id);

    const listed = async (auth: Auth) =>
      (
        (await (
          await request("GET", "/api/conversations", auth)
        ).json()) as Array<{
          phone_number: string;
        }>
      ).map((r) => r.phone_number);

    describe("on a conversation assigned to another agent", () => {
      it("is refused the detail", async () => {
        const detail = await request(
          "GET",
          `/api/conversations/${OWNED}`,
          other,
        );
        expect(detail.status).toBe(404);
      });

      it("is refused takeover", async () => {
        const takeover = await request(
          "POST",
          `/api/conversations/${OWNED}/takeover`,
          other,
        );

        expect(statusOf(OWNED)).toBe("active");
        expect(takeover.status).toBe(404);
      });

      it("is refused release", async () => {
        await takeoverConversation(alpha.ref(OWNED), owner);
        expect(statusOf(OWNED)).toBe("human_takeover");

        const release = await request(
          "POST",
          `/api/conversations/${OWNED}/release`,
          other,
        );

        expect(statusOf(OWNED)).toBe("human_takeover");
        expect(release.status).toBe(404);
      });

      it("is not listed its orders", async () => {
        expect(await orderIds(other)).not.toContain(ownedOrderId);
        expect(
          (
            (await (
              await request("GET", "/api/orders/metrics", other)
            ).json()) as { totalOrders: number }
          ).totalOrders,
        ).toBe(0);
      });

      it("is refused its order", async () => {
        expect(
          (await request("GET", `/api/orders/${ownedOrderId}`, other)).status,
        ).toBe(404);
        expect(
          await (
            await request("GET", `/api/orders/by-conversation/${OWNED}`, other)
          ).json(),
        ).toEqual({ order: null });
      });
    });

    describe("on an unassigned conversation", () => {
      it("opens it and takes it over, as the escalation alert asks", async () => {
        expect(
          (await request("GET", `/api/conversations/${OPEN}`, other)).status,
        ).toBe(200);
        expect(
          (await request("POST", `/api/conversations/${OPEN}/takeover`, other))
            .status,
        ).toBe(200);
        expect(statusOf(OPEN)).toBe("human_takeover");
      });

      it("is still refused its order", async () => {
        expect(await orderIds(other)).not.toContain(openOrderId);
        expect(
          (await request("GET", `/api/orders/${openOrderId}`, other)).status,
        ).toBe(404);
        expect(
          await (
            await request("GET", `/api/orders/by-conversation/${OPEN}`, other)
          ).json(),
        ).toEqual({ order: null });
      });

      it("sees the order it creates there, and no other agent does", async () => {
        const response = await request("POST", "/api/orders", other, {
          conversationPhone: OPEN,
          clientName: "Cliente",
          clientDni: "12345678",
          products: [
            { productId: "p1", name: "Terma", price: 900, quantity: 1 },
          ],
          totalAmount: 900,
          deliveryAddress: "Av. Siempre Viva 123",
        });
        expect(response.status).toBe(201);
        const { id } = (await response.json()) as { id: string };

        expect((await request("GET", `/api/orders/${id}`, other)).status).toBe(
          200,
        );
        expect(await orderIds(other)).toContain(id);
        expect(await orderIds(other)).not.toContain(openOrderId);
        expect(await orderIds(assigned)).not.toContain(id);
      });
    });

    it("lists their own and unassigned conversations, not another agent's", async () => {
      const mine = await listed(assigned);
      expect(mine).toContain(OWNED);
      expect(mine).toContain(OPEN);

      const theirs = await listed(other);
      expect(theirs).toContain(OPEN);
      expect(theirs).not.toContain(OWNED);
    });

    it("reads and acts on the conversation assigned to them and its order", async () => {
      expect(
        (await request("GET", `/api/conversations/${OWNED}`, assigned)).status,
      ).toBe(200);
      expect(
        (
          await request(
            "POST",
            `/api/conversations/${OWNED}/takeover`,
            assigned,
          )
        ).status,
      ).toBe(200);

      expect(await orderIds(assigned)).toContain(ownedOrderId);
      expect(await orderIds(assigned)).not.toContain(openOrderId);
      expect(
        (await request("GET", `/api/orders/${ownedOrderId}`, assigned)).status,
      ).toBe(200);
      expect(
        (
          (await (
            await request(
              "GET",
              `/api/orders/by-conversation/${OWNED}`,
              assigned,
            )
          ).json()) as { order: { id: string } | null }
        ).order?.id,
      ).toBe(ownedOrderId);
    });

    it("leaves every other role the whole tenant", async () => {
      expect(
        (await request("GET", `/api/conversations/${OWNED}`, alphaAdmin))
          .status,
      ).toBe(200);
      expect(await orderIds(alphaAdmin)).toContain(ownedOrderId);
      expect(await orderIds(alphaAdmin)).toContain(openOrderId);

      const supervisor = login(
        createMember(alpha, "supervisor").userId,
        alpha.tenantId,
      );
      expect(await orderIds(supervisor)).toContain(ownedOrderId);
    });
  });

  describe("a supervisor", () => {
    const PHONE = "51900777002";

    it("gets the same verdict from the conversation list and the detail", async () => {
      insertConversation(alpha.ref(PHONE), { clientName: "Cliente" });
      const supervisor = login(
        createMember(alpha, "supervisor").userId,
        alpha.tenantId,
      );

      const list = await request("GET", "/api/conversations", supervisor);
      const detail = await request(
        "GET",
        `/api/conversations/${PHONE}`,
        supervisor,
      );

      expect(list.status).toBe(detail.status);
      expect(list.status).toBe(200);
      const rows = (await list.json()) as Array<{ phone_number: string }>;
      expect(rows.map((r) => r.phone_number)).toContain(PHONE);
    });
  });

  describe("claiming a WhatsApp number", () => {
    const create = (auth: Auth, phoneNumberId: string) =>
      request("POST", "/api/admin/channels", auth, {
        phoneNumberId,
        label: "Nueva línea",
      });

    it("is refused to a tenant admin", async () => {
      const phoneNumberId = `pnid-${crypto.randomUUID().slice(0, 8)}`;

      const response = await create(alphaAdmin, phoneNumberId);

      expect(response.status).toBe(403);
      expect(
        ChannelAccountService.getByPhoneNumberId(phoneNumberId),
      ).toBeNull();
    });

    it("does not tell a tenant admin that another tenant holds a number", async () => {
      const response = await create(alphaAdmin, beta.phoneNumberId);
      expect(response.status).toBe(403);
    });

    it("is allowed to a platform operator", async () => {
      const operator = login(createOperator(), alpha.tenantId);
      const phoneNumberId = `pnid-${crypto.randomUUID().slice(0, 8)}`;

      const response = await create(operator, phoneNumberId);

      expect(response.status).toBe(201);
      expect(
        ChannelAccountService.getByPhoneNumberId(phoneNumberId)?.tenant_id,
      ).toBe(alpha.tenantId);
    });
  });

  describe("a refused channel PATCH", () => {
    let savedKey: string | undefined;
    let pendingId: string;

    beforeEach(() => {
      savedKey = process.env.SECRETS_KEY;
      process.env.SECRETS_KEY = "c3".repeat(32);
      pendingId = ChannelAccountService.create({
        tenantId: alpha.tenantId,
        phoneNumberId: `pnid-${crypto.randomUUID().slice(0, 8)}`,
      }).id;
    });

    afterEach(() => {
      if (savedKey === undefined) {
        delete process.env.SECRETS_KEY;
      } else {
        process.env.SECRETS_KEY = savedKey;
      }
    });

    const secretCount = () =>
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM channel_secrets WHERE tenant_id = ?",
          )
          .get(alpha.tenantId) as { n: number }
      ).n;

    it("leaves the account as it was when one field is malformed", async () => {
      const before = ChannelAccountService.getById(pendingId);
      const secretsBefore = secretCount();

      const response = await request(
        "PATCH",
        `/api/admin/channels/${pendingId}`,
        alphaAdmin,
        { accessToken: "EAAG-good-token", verifyToken: 123 },
      );

      // The stored state first: on the old code the token was written and the
      // account activated before the 500.
      expect(ChannelAccountService.getById(pendingId)).toEqual(before);
      expect(secretCount()).toBe(secretsBefore);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });
  });
});

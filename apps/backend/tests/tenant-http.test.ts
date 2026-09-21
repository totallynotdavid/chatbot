/**
 * Authorization at the HTTP layer, through the real routers, the real
 * `requireAuth` and a real session cookie. `src/index.ts` is not imported,
 * because importing it starts the aggregator worker and reassignment timers.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import process from "node:process";
import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { db } from "../src/db/index.ts";
import type { Bundle } from "@vendeya/types";

import {
  addChannelAccount,
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import {
  activeTenantId,
  requireAuth,
  requireRole,
} from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error.ts";
import {
  createSession,
  defaultTenantForUser,
  generateSessionToken,
  validateSessionToken,
} from "../src/platform/auth/session.ts";
import { hasRole, sessionRole } from "../src/platform/auth/scope.ts";
import conversationRoutes from "../src/routes/conversations.ts";
import catalogRoutes from "../src/routes/catalog.ts";
import orderRoutes from "../src/routes/orders.ts";
import assetRoutes from "../src/routes/assets.ts";
import tenantRoutes from "../src/routes/tenants.ts";
import authRoutes from "../src/routes/auth.ts";
import adminUserRoutes from "../src/routes/admin/users.ts";
import adminSystemRoutes from "../src/routes/admin/system.ts";
import adminChannelRoutes from "../src/routes/admin/channels.ts";
import {
  SystemSettings,
  TenantSettings,
} from "../src/domains/settings/system.ts";
import { MembershipService } from "../src/domains/tenants/index.ts";
import { AssetService } from "../src/domains/assets/index.ts";
import { BundleService } from "../src/domains/catalog/bundles.ts";
import { PeriodService } from "../src/domains/catalog/periods.ts";
import { ProductService } from "../src/domains/catalog/products.ts";
import { createOrder } from "../src/domains/orders/write.ts";
import { assignNextAgent } from "../src/domains/conversations/assignment.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";

const SHARED_PHONE = "51987654321";

function buildApp() {
  const app = new Hono();
  // Mounted before the global requireAuth, as index.ts does. Of the routes
  // mounted here, only logging in needs no session.
  app.route("/api/auth", authRoutes);
  app.use("/api/*", requireAuth);
  app.route("/api/conversations", conversationRoutes);
  app.route("/api/catalog", catalogRoutes);
  app.route("/api/orders", orderRoutes);
  app.route("/api/assets", assetRoutes);
  app.route("/api/tenants", tenantRoutes);
  // Mounted the way index.ts mounts them, admin gate included.
  app.use("/api/admin/*", requireRole("admin"));
  app.route("/api/admin/users", adminUserRoutes);
  app.route("/api/admin/channels", adminChannelRoutes);
  app.route("/api/admin", adminSystemRoutes);
  return app;
}

/** A logged-in user, as a cookie the app will accept. */
function login(
  userId: string,
  activeTenantId: string | null,
): { cookie: string; token: string } {
  const token = generateSessionToken();
  createSession(token, userId, activeTenantId);
  return { cookie: `session=${token}`, token };
}

function createUser(options: {
  tenantId?: string;
  role?: "admin" | "developer" | "supervisor" | "sales_agent";
  isPlatformOperator?: boolean;
}): string {
  const userId = `u-${crypto.randomUUID()}`;
  const role = options.role ?? "admin";

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, name, is_platform_operator)
     VALUES (?, ?, 'x', ?, 'Test User', ?)`,
  ).run(
    userId,
    `user-${userId.slice(2, 12)}`,
    role,
    options.isPlatformOperator ? 1 : 0,
  );

  if (options.tenantId) {
    db.prepare(
      `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
       VALUES (?, ?, ?, ?)`,
    ).run(crypto.randomUUID(), options.tenantId, userId, role);
  }

  return userId;
}

describe("HTTP authorization", () => {
  let app: ReturnType<typeof buildApp>;
  let alpha: TenantFixture;
  let beta: TenantFixture;

  let alphaAdmin: { cookie: string; token: string };
  let betaAdmin: { cookie: string; token: string };

  beforeEach(() => {
    applySchema();
    app = buildApp();

    alpha = createTenantFixture("alpha-http");
    beta = createTenantFixture("beta-http");

    alphaAdmin = login(
      createUser({ tenantId: alpha.tenantId }),
      alpha.tenantId,
    );
    betaAdmin = login(createUser({ tenantId: beta.tenantId }), beta.tenantId);

    insertConversation(alpha.ref(SHARED_PHONE), { clientName: "Alpha Client" });
    insertConversation(beta.ref(SHARED_PHONE), { clientName: "Beta Client" });
  });

  afterEach(() => {
    dropTenantFixture(alpha);
    dropTenantFixture(beta);
  });

  function get(path: string, auth?: { cookie: string }) {
    return app.request(path, {
      headers: auth ? { Cookie: auth.cookie } : {},
    });
  }

  /** GET a path and read the JSON body, typed by the caller. */
  async function getJson<T = any>(
    path: string,
    auth?: { cookie: string },
  ): Promise<T> {
    return (await get(path, auth)).json() as Promise<T>;
  }

  function patch(path: string, auth: { cookie: string }, body: unknown) {
    return app.request(path, {
      method: "PATCH",
      headers: { Cookie: auth.cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function post(path: string, auth: { cookie: string }, body: unknown) {
    return app.request(path, {
      method: "POST",
      headers: { Cookie: auth.cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects a request with no session", async () => {
    const response = await get("/api/conversations");
    expect(response.status).toBe(401);
  });

  it("serves each tenant its own copy of the same phone number", async () => {
    const fromAlpha = await getJson(
      `/api/conversations/${SHARED_PHONE}`,
      alphaAdmin,
    );
    const fromBeta = await getJson(
      `/api/conversations/${SHARED_PHONE}`,
      betaAdmin,
    );

    expect(fromAlpha.conversation.client_name).toBe("Alpha Client");
    expect(fromAlpha.conversation.tenant_id).toBe(alpha.tenantId);
    expect(fromBeta.conversation.client_name).toBe("Beta Client");
    expect(fromBeta.conversation.tenant_id).toBe(beta.tenantId);
  });

  it("lists only the caller's tenant's conversations", async () => {
    const rows = await getJson<Array<{ tenant_id: string }>>(
      "/api/conversations",
      alphaAdmin,
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((r: { tenant_id: string }) => r.tenant_id === alpha.tenantId),
    ).toBe(true);
  });

  it("404s a conversation that exists only in another tenant", async () => {
    const onlyInBeta = "51900000001";
    insertConversation(beta.ref(onlyInBeta), { clientName: "Beta Only" });

    const response = await get(`/api/conversations/${onlyInBeta}`, alphaAdmin);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Conversation not found" });
  });

  it("does not leak another tenant's catalog", async () => {
    const betaPeriod = PeriodService.create({
      tenantId: beta.tenantId,
      name: "Septiembre",
      year_month: "2026-09",
      created_by: null,
    });
    ProductService.create({
      id: `prod-${crypto.randomUUID()}`,
      tenantId: beta.tenantId,
      name: "Beta Product",
      category: "cocinas",
    });

    expect(
      await getJson<unknown[]>("/api/catalog/products", alphaAdmin),
    ).toEqual([]);
    expect(await getJson("/api/catalog/products", betaAdmin)).toHaveLength(1);

    // Even naming the other tenant's period explicitly returns nothing.
    expect(
      await getJson<unknown[]>(
        `/api/catalog/bundles?period_id=${betaPeriod.id}`,
        alphaAdmin,
      ),
    ).toEqual([]);
  });

  function createAlphaPeriod() {
    return PeriodService.create({
      tenantId: alpha.tenantId,
      name: "Septiembre",
      year_month: "2026-09",
      created_by: null,
    });
  }

  function createAlphaBundle(periodId: string, name: string) {
    return BundleService.create({
      id: `bundle-${crypto.randomUUID()}`,
      tenantId: alpha.tenantId,
      period_id: periodId,
      segment: "gaso",
      name,
      price: 1000,
      primary_category: "cocinas",
      categories_json: JSON.stringify(["cocinas"]),
      image_id: `img-${crypto.randomUUID()}`,
      composition_json: JSON.stringify([]),
      installments_json: JSON.stringify([]),
      created_by: null,
    });
  }

  /** The row as stored, read without a tenant filter so a moved row is still found. */
  function storedBundle(id: string) {
    return db.prepare("SELECT * FROM catalog_bundles WHERE id = ?").get(id) as
      | Bundle
      | undefined;
  }

  /**
   * The bundle PATCH and bulk-update routes pass the request body to the
   * service as `updates`. The service must drop off-list keys, because a new
   * `tenant_id` would move the row to another business.
   */
  it("ignores off-list fields in a bundle PATCH instead of moving the row", async () => {
    const bundle = createAlphaBundle(createAlphaPeriod().id, "Alpha Bundle");

    const response = await patch(
      `/api/catalog/bundles/${bundle.id}`,
      alphaAdmin,
      { name: "Renamed", tenant_id: beta.tenantId },
    );

    // Checked before the response is read: whatever the route answers, the row
    // must not have left the tenant that owns it.
    const stored = storedBundle(bundle.id);
    expect(stored?.tenant_id).toBe(alpha.tenantId);

    // Dropped, not rejected: the request succeeds and the rename still lands.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tenant_id: alpha.tenantId,
      name: "Renamed",
    });
    expect(stored?.name).toBe("Renamed");

    // And the bundle never surfaces in the tenant the body named.
    expect(
      await getJson<unknown[]>(
        `/api/catalog/bundles?period_id=${bundle.period_id}`,
        betaAdmin,
      ),
    ).toEqual([]);

    // Other off-list columns, here `id` and `period_id`, are dropped the same
    // way, and an on-list column such as `notes` still lands.
    const second = await patch(
      `/api/catalog/bundles/${bundle.id}`,
      alphaAdmin,
      { id: "hijacked-id", period_id: "no-such-period", notes: "Nota nueva" },
    );

    expect(second.status).toBe(200);
    const after = storedBundle(bundle.id);
    expect(after?.id).toBe(bundle.id);
    expect(after?.period_id).toBe(bundle.period_id);
    expect(after?.notes).toBe("Nota nueva");
  });

  it("ignores off-list fields in a bundle bulk-update", async () => {
    const period = createAlphaPeriod();
    const first = createAlphaBundle(period.id, "Bulk One");
    const second = createAlphaBundle(period.id, "Bulk Two");

    const response = await post(
      "/api/catalog/bundles/bulk-update",
      alphaAdmin,
      {
        ids: [first.id, second.id],
        updates: { is_active: 0, tenant_id: beta.tenantId },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ count: 2 });

    for (const bundle of [first, second]) {
      const stored = storedBundle(bundle.id);
      expect(stored?.tenant_id).toBe(alpha.tenantId);
      expect(stored?.is_active).toBe(0);
    }
  });

  it("does not leak another tenant's orders", async () => {
    const betaOrder = createOrder({
      ref: beta.ref(SHARED_PHONE),
      clientName: "Beta Client",
      clientDni: "87654321",
      products: [{ productId: "p1", name: "Terma", price: 200, quantity: 1 }],
      totalAmount: 200,
      deliveryAddress: "Callao",
    });

    expect(await getJson<unknown[]>("/api/orders", alphaAdmin)).toEqual([]);

    const byId = await get(`/api/orders/${betaOrder.id}`, alphaAdmin);
    expect(byId.status).toBe(404);

    expect(
      await getJson<{ order: unknown }>(
        `/api/orders/by-conversation/${SHARED_PHONE}`,
        alphaAdmin,
      ),
    ).toEqual({ order: null });

    // ...and the owner still sees it.
    const asOwner = await getJson<{ id: string }>(
      `/api/orders/${betaOrder.id}`,
      betaAdmin,
    );
    expect(asOwner.id).toBe(betaOrder.id);
  });

  it("does not resolve another tenant's private asset", async () => {
    const betaAsset = AssetService.create({
      tenantId: beta.tenantId,
      kind: "contract",
      visibility: "private",
      storageKey: `${beta.tenantId}/contracts/x.pdf`,
    });

    const response = await get(`/api/assets/${betaAsset.id}`, alphaAdmin);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Asset not found" });
  });

  it("refuses a logged-in user who belongs to no tenant", async () => {
    const orphan = login(createUser({}), null);

    const conversations = await get("/api/conversations", orphan);
    expect(conversations.status).toBe(403);

    const catalog = await get("/api/catalog/products", orphan);
    expect(catalog.status).toBe(403);
  });

  it("drops the tenant pin when a membership is revoked", async () => {
    const userId = createUser({ tenantId: alpha.tenantId });
    const session = login(userId, alpha.tenantId);

    expect((await get("/api/conversations", session)).status).toBe(200);

    db.prepare(
      "DELETE FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?",
    ).run(alpha.tenantId, userId);

    // Same cookie, no membership: the scope is gone on the very next request.
    expect((await get("/api/conversations", session)).status).toBe(403);
  });

  /**
   * Dropping the pin leaves a user with one membership and no active tenant,
   * and every tenant-scoped page answers 403 until they pin it. The API allows
   * that selection. The dashboard must therefore show the selector for a single
   * unpinned membership (see the frontend's showTenantSelector).
   */
  it("lets a member whose pin was dropped select the membership they keep", async () => {
    const userId = createUser({ tenantId: alpha.tenantId });
    db.prepare(
      `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
       VALUES (?, ?, ?, 'admin')`,
    ).run(crypto.randomUUID(), beta.tenantId, userId);

    const session = login(userId, alpha.tenantId);

    db.prepare(
      "DELETE FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?",
    ).run(alpha.tenantId, userId);

    expect((await get("/api/conversations", session)).status).toBe(403);

    // Unpinned with one membership left. The membership is still listed, and
    // the selector is populated from that list.
    const listed = await getJson<{
      tenants: Array<{ id: string }>;
      activeTenantId: string | null;
    }>("/api/tenants", session);

    expect(listed.activeTenantId).toBeNull();
    expect(listed.tenants.map((t) => t.id)).toEqual([beta.tenantId]);

    const selected = await post("/api/tenants/active", session, {
      tenantId: beta.tenantId,
    });

    expect(selected.status).toBe(200);
    expect((await get("/api/conversations", session)).status).toBe(200);
  });

  /**
   * `users.username` is one namespace across the platform, so a tenant admin
   * learns whether a name is free. They must learn nothing more. A name taken
   * in another tenant answers exactly like a name taken in this one.
   */
  describe("taking a username already used in another tenant", () => {
    function createMember(auth: { cookie: string }, username: string) {
      return app.request("/api/admin/users", {
        method: "POST",
        headers: { Cookie: auth.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password: "a-long-enough-password",
          role: "sales_agent",
          name: "Nuevo",
        }),
      });
    }

    it("answers the same whether the name is taken here or elsewhere", async () => {
      const mine = `mine-${crypto.randomUUID().slice(0, 8)}`;
      const theirs = `theirs-${crypto.randomUUID().slice(0, 8)}`;

      expect((await createMember(alphaAdmin, mine)).status).toBe(200);
      expect((await createMember(betaAdmin, theirs)).status).toBe(200);

      // Alpha's admin can see `mine` in their own member list, so refusing it
      // tells them nothing they did not already know.
      const taken = await createMember(alphaAdmin, mine);
      // `theirs` belongs to a tenant alpha cannot see at all.
      const elsewhere = await createMember(alphaAdmin, theirs);

      expect(taken.status).toBe(409);
      expect(elsewhere.status).toBe(409);

      const takenBody = await taken.json();
      const elsewhereBody = await elsewhere.json();

      // Identical bodies: the response is not an oracle for cross-tenant
      // existence, only for availability, which the constraint forces anyway.
      expect(elsewhereBody).toEqual(takenBody);
      expect(JSON.stringify(elsewhereBody)).not.toContain("already exists");
    });

    it("still refuses to create the duplicate", async () => {
      const username = `dup-${crypto.randomUUID().slice(0, 8)}`;

      await createMember(betaAdmin, username);
      await createMember(alphaAdmin, username);

      expect(
        db
          .prepare("SELECT COUNT(*) as c FROM users WHERE username = ?")
          .get(username),
      ).toEqual({ c: 1 });
    });
  });

  /**
   * `password_hash` lives on the global user record. Resetting it for a user who
   * also belongs to another tenant would give the acting admin that user's
   * access everywhere, which is a cross-tenant account takeover.
   */
  describe("password reset cannot become cross-tenant access", () => {
    function hashOf(userId: string): string {
      return (
        db
          .prepare("SELECT password_hash FROM users WHERE id = ?")
          .get(userId) as { password_hash: string }
      ).password_hash;
    }

    function resetPassword(auth: { cookie: string }, userId: string) {
      return app.request(`/api/admin/users/${userId}/password`, {
        method: "POST",
        headers: { Cookie: auth.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: "a-new-password" }),
      });
    }

    it("refuses when the target also belongs to another tenant", async () => {
      const shared = createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
      });
      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'sales_agent')`,
      ).run(crypto.randomUUID(), beta.tenantId, shared);

      const before = hashOf(shared);
      const response = await resetPassword(alphaAdmin, shared);

      expect(response.status).toBe(403);
      expect(hashOf(shared)).toBe(before);
    });

    it("still allows it for a user whose only tenant is this one", async () => {
      const own = createUser({ tenantId: alpha.tenantId, role: "sales_agent" });
      const before = hashOf(own);

      const response = await resetPassword(alphaAdmin, own);

      expect(response.status).toBe(200);
      expect(hashOf(own)).not.toBe(before);
    });

    it("counts a membership in a suspended tenant too", async () => {
      const shared = createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
      });
      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'sales_agent')`,
      ).run(crypto.randomUUID(), beta.tenantId, shared);
      // A suspended tenant can be reactivated, so the account still reaches it.
      db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(
        beta.tenantId,
      );

      const before = hashOf(shared);
      expect((await resetPassword(alphaAdmin, shared)).status).toBe(403);
      expect(hashOf(shared)).toBe(before);
    });

    it("lets a platform operator reset a multi-tenant user's password", async () => {
      const shared = createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
      });
      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'sales_agent')`,
      ).run(crypto.randomUUID(), beta.tenantId, shared);

      const operator = login(
        createUser({ isPlatformOperator: true }),
        alpha.tenantId,
      );

      const before = hashOf(shared);
      expect((await resetPassword(operator, shared)).status).toBe(200);
      expect(hashOf(shared)).not.toBe(before);
    });

    it("still refuses a user who is not in the acting tenant at all", async () => {
      const betaOnly = createUser({ tenantId: beta.tenantId });
      expect((await resetPassword(alphaAdmin, betaOnly)).status).toBe(404);
    });
  });

  /**
   * `is_active` is on the global user record too. Deactivating a user who also
   * belongs to another tenant would lock them out of that other business. The
   * rule is the same as for the password reset above.
   */
  describe("deactivation cannot reach another tenant", () => {
    function isActive(userId: string): number {
      return (
        db.prepare("SELECT is_active FROM users WHERE id = ?").get(userId) as {
          is_active: number;
        }
      ).is_active;
    }

    function toggleStatus(auth: { cookie: string }, userId: string) {
      return app.request(`/api/admin/users/${userId}/status`, {
        method: "PATCH",
        headers: { Cookie: auth.cookie },
      });
    }

    /** A user who works for both businesses. */
    function sharedUser(): string {
      const userId = createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
      });
      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'sales_agent')`,
      ).run(crypto.randomUUID(), beta.tenantId, userId);
      return userId;
    }

    it("refuses to deactivate a user who also belongs to another tenant", async () => {
      const shared = sharedUser();

      const response = await toggleStatus(alphaAdmin, shared);

      expect(response.status).toBe(403);
      expect(isActive(shared)).toBe(1);
    });

    it("leaves the shared user's session in the other tenant alone", async () => {
      const shared = sharedUser();
      const theirSession = login(shared, beta.tenantId);

      await toggleStatus(alphaAdmin, shared);

      // Still working in the tenant the acting admin has nothing to do with.
      expect((await get("/api/conversations", theirSession)).status).toBe(200);
    });

    it("refuses to reactivate one either", async () => {
      const shared = sharedUser();
      db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(shared);

      const response = await toggleStatus(alphaAdmin, shared);

      expect(response.status).toBe(403);
      expect(isActive(shared)).toBe(0);
    });

    it("counts a membership in a suspended tenant too", async () => {
      const shared = sharedUser();
      db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(
        beta.tenantId,
      );

      expect((await toggleStatus(alphaAdmin, shared)).status).toBe(403);
      expect(isActive(shared)).toBe(1);
    });

    it("still allows it for a user whose only tenant is this one", async () => {
      const own = createUser({ tenantId: alpha.tenantId, role: "sales_agent" });

      const response = await toggleStatus(alphaAdmin, own);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, is_active: 0 });
      expect(isActive(own)).toBe(0);
    });

    it("lets a platform operator deactivate a multi-tenant user", async () => {
      const shared = sharedUser();
      const operator = login(
        createUser({ isPlatformOperator: true }),
        alpha.tenantId,
      );

      expect((await toggleStatus(operator, shared)).status).toBe(200);
      expect(isActive(shared)).toBe(0);
    });

    it("still refuses a user who is not in the acting tenant at all", async () => {
      const betaOnly = createUser({ tenantId: beta.tenantId });
      expect((await toggleStatus(alphaAdmin, betaOnly)).status).toBe(404);
    });

    it("removing the membership is the tenant-scoped alternative", async () => {
      const shared = sharedUser();

      const removed = await app.request(
        `/api/admin/users/${shared}/membership`,
        { method: "DELETE", headers: { Cookie: alphaAdmin.cookie } },
      );

      expect(removed.status).toBe(200);
      // Gone from this tenant, account and other tenant untouched.
      expect(MembershipService.get(alpha.tenantId, shared)).toBeNull();
      expect(MembershipService.get(beta.tenantId, shared)).not.toBeNull();
      expect(isActive(shared)).toBe(1);
    });
  });

  /**
   * The browser drops the cookie at the expiry it got at login. A renewal moves
   * `expires_at` in the database, so the response must carry the cookie again,
   * or the user is logged out while the row is still valid.
   */
  describe("session renewal reaches the browser", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    function withDaysLeft(days: number): { cookie: string; id: string } {
      const token = generateSessionToken();
      const session = createSession(
        token,
        createUser({ tenantId: alpha.tenantId }),
        alpha.tenantId,
      );
      db.prepare("UPDATE session SET expires_at = ? WHERE id = ?").run(
        Math.floor((Date.now() + days * DAY_MS) / 1000),
        session.id,
      );
      return { cookie: `session=${token}`, id: session.id };
    }

    function storedExpiry(sessionId: string): number {
      return (
        db
          .prepare("SELECT expires_at FROM session WHERE id = ?")
          .get(sessionId) as { expires_at: number }
      ).expires_at;
    }

    it("sets the cookie again, about 30 days out, when it renews", async () => {
      const session = withDaysLeft(10);

      const response = await get("/api/conversations", session);

      expect(response.status).toBe(200);
      const setCookie = response.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(`${session.cookie};`);
      const expires = /Expires=([^;]+)/i.exec(setCookie)?.[1];
      expect(expires).toBeDefined();
      const cookieExpiry = Date.parse(expires!);
      expect(Math.abs(cookieExpiry - (Date.now() + 30 * DAY_MS))).toBeLessThan(
        60_000,
      );
      // The cookie and the row agree, to the second the cookie is rounded to.
      expect(
        Math.abs(cookieExpiry - storedExpiry(session.id) * 1000),
      ).toBeLessThan(2_000);
    });

    it("sends no cookie while more than 15 days remain", async () => {
      const session = withDaysLeft(20);
      const before = storedExpiry(session.id);

      const response = await get("/api/conversations", session);

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(storedExpiry(session.id)).toBe(before);
    });

    it("sends no cookie on the request after a renewal", async () => {
      const session = withDaysLeft(10);

      await get("/api/conversations", session);
      const again = await get("/api/conversations", session);

      expect(again.status).toBe(200);
      expect(again.headers.get("set-cookie")).toBeNull();
    });
  });

  /**
   * Changing a role or a membership is a tenant matter, so it works for a user
   * who belongs to other tenants too. VendeYa staff is the exception: their
   * powers live on the account, but a tenant admin could still lock them out.
   */
  describe("a tenant admin and VendeYa staff's membership", () => {
    function roleOf(tenantId: string, userId: string): string | undefined {
      return MembershipService.get(tenantId, userId)?.role;
    }

    function changeRole(
      auth: { cookie: string },
      userId: string,
      role: string,
    ) {
      return patch(`/api/admin/users/${userId}/role`, auth, { role });
    }

    function removeMembership(auth: { cookie: string }, userId: string) {
      return app.request(`/api/admin/users/${userId}/membership`, {
        method: "DELETE",
        headers: { Cookie: auth.cookie },
      });
    }

    /** A promoted member account: an operator who kept a membership. */
    function operatorMember(): string {
      return createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
        isPlatformOperator: true,
      });
    }

    it("refuses to change an operator's role and leaves the row alone", async () => {
      const operator = operatorMember();

      const response = await changeRole(alphaAdmin, operator, "developer");

      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toContain(
        "VendeYa staff",
      );
      expect(roleOf(alpha.tenantId, operator)).toBe("sales_agent");
    });

    it("refuses to remove an operator's membership and leaves the row alone", async () => {
      const operator = operatorMember();

      const response = await removeMembership(alphaAdmin, operator);

      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toContain(
        "VendeYa staff",
      );
      expect(roleOf(alpha.tenantId, operator)).toBe("sales_agent");
    });

    it("refuses an operator who also belongs to another tenant, all the same", async () => {
      const operator = operatorMember();
      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'sales_agent')`,
      ).run(crypto.randomUUID(), beta.tenantId, operator);

      expect((await changeRole(alphaAdmin, operator, "developer")).status).toBe(
        403,
      );
      expect((await removeMembership(alphaAdmin, operator)).status).toBe(403);
      expect(roleOf(alpha.tenantId, operator)).toBe("sales_agent");
    });

    it("lets a platform operator change the role of another operator", async () => {
      const target = operatorMember();
      const caller = login(
        createUser({ isPlatformOperator: true }),
        alpha.tenantId,
      );

      const response = await changeRole(caller, target, "developer");

      expect(response.status).toBe(200);
      expect(roleOf(alpha.tenantId, target)).toBe("developer");
    });

    it("lets a platform operator remove an operator's membership", async () => {
      const target = operatorMember();
      const caller = login(
        createUser({ isPlatformOperator: true }),
        alpha.tenantId,
      );

      const response = await removeMembership(caller, target);

      expect(response.status).toBe(200);
      expect(MembershipService.get(alpha.tenantId, target)).toBeNull();
    });

    it("still lets a tenant admin change an ordinary member's role", async () => {
      const member = createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
      });

      const response = await changeRole(alphaAdmin, member, "supervisor");

      expect(response.status).toBe(200);
      expect(roleOf(alpha.tenantId, member)).toBe("supervisor");
    });

    it("still lets a tenant admin remove an ordinary member", async () => {
      const member = createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
      });

      const response = await removeMembership(alphaAdmin, member);

      expect(response.status).toBe(200);
      expect(MembershipService.get(alpha.tenantId, member)).toBeNull();
    });

    it("still lets a tenant admin change the role of a multi-tenant member", async () => {
      const member = createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
      });
      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'sales_agent')`,
      ).run(crypto.randomUUID(), beta.tenantId, member);

      expect((await changeRole(alphaAdmin, member, "supervisor")).status).toBe(
        200,
      );
      expect(roleOf(alpha.tenantId, member)).toBe("supervisor");
      expect(roleOf(beta.tenantId, member)).toBe("sales_agent");
    });

    /**
     * `validateSessionToken` re-reads the membership on every request, so a
     * role change needs no session to be deleted. Deleting them only logged the
     * user out of every tenant they belong to.
     */
    describe("a role change and the user's session", () => {
      it("shows the new role on the next request with the same session", async () => {
        const member = createUser({
          tenantId: alpha.tenantId,
          role: "sales_agent",
        });
        const session = login(member, alpha.tenantId);

        expect((await get("/api/admin/users", session)).status).toBe(403);

        expect((await changeRole(alphaAdmin, member, "admin")).status).toBe(
          200,
        );
        expect((await get("/api/admin/users", session)).status).toBe(200);

        expect(
          (await changeRole(alphaAdmin, member, "sales_agent")).status,
        ).toBe(200);
        expect((await get("/api/admin/users", session)).status).toBe(403);
      });

      it("keeps the user logged in, in this tenant and in the others", async () => {
        const member = createUser({
          tenantId: alpha.tenantId,
          role: "sales_agent",
        });
        db.prepare(
          `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
           VALUES (?, ?, ?, 'sales_agent')`,
        ).run(crypto.randomUUID(), beta.tenantId, member);
        const inAlpha = login(member, alpha.tenantId);
        const inBeta = login(member, beta.tenantId);

        await changeRole(alphaAdmin, member, "supervisor");

        expect((await get("/api/conversations", inAlpha)).status).toBe(200);
        expect((await get("/api/conversations", inBeta)).status).toBe(200);
      });
    });
  });

  /**
   * A conversation is (tenant, channel account, phone number). The `:phone`
   * parameter alone is ambiguous when a contact writes to two of the tenant's
   * numbers, so the API must refuse to guess which thread is meant.
   */
  describe("a contact on two of the tenant's numbers", () => {
    let second: ReturnType<typeof addChannelAccount>;

    beforeEach(() => {
      second = addChannelAccount(alpha);
      insertConversation(second.ref(SHARED_PHONE), {
        clientName: "Alpha Client, second number",
      });
    });

    it("refuses to guess which thread is meant", async () => {
      const response = await get(
        `/api/conversations/${SHARED_PHONE}`,
        alphaAdmin,
      );

      expect(response.status).toBe(409);

      const body = (await response.json()) as {
        error: string;
        channels: Array<{ channelAccountId: string }>;
      };
      expect(body.error).toBe("Ambiguous conversation");
      expect(body.channels.map((ch) => ch.channelAccountId).sort()).toEqual(
        [alpha.channelAccountId, second.channelAccountId].sort(),
      );
    });

    it("opens the named thread when the channel account is given", async () => {
      const first = await getJson(
        `/api/conversations/${SHARED_PHONE}?channel=${alpha.channelAccountId}`,
        alphaAdmin,
      );
      const other = await getJson(
        `/api/conversations/${SHARED_PHONE}?channel=${second.channelAccountId}`,
        alphaAdmin,
      );

      expect(first.conversation.client_name).toBe("Alpha Client");
      expect(first.conversation.channel_account_id).toBe(
        alpha.channelAccountId,
      );
      expect(other.conversation.client_name).toBe(
        "Alpha Client, second number",
      );
      expect(other.conversation.channel_account_id).toBe(
        second.channelAccountId,
      );
    });

    it("does not attach an order to a guessed thread", async () => {
      expect(
        await getJson<{ order: unknown }>(
          `/api/orders/by-conversation/${SHARED_PHONE}`,
          alphaAdmin,
        ),
      ).toEqual({ order: null });
    });

    it("refuses to create an order without the channel account", async () => {
      const body = {
        conversationPhone: SHARED_PHONE,
        clientName: "Alpha Client",
        clientDni: "12345678",
        products: [],
        totalAmount: 100,
        deliveryAddress: "Lima",
      };

      const ambiguous = await app.request("/api/orders", {
        method: "POST",
        headers: {
          Cookie: alphaAdmin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      expect(ambiguous.status).toBe(409);

      const named = await app.request("/api/orders", {
        method: "POST",
        headers: {
          Cookie: alphaAdmin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...body,
          channelAccountId: second.channelAccountId,
        }),
      });
      expect(named.status).toBe(201);
      const created = (await named.json()) as { channel_account_id: string };
      expect(created.channel_account_id).toBe(second.channelAccountId);
    });

    it("a still-unambiguous contact needs no channel account", async () => {
      const onlyOnce = "51900000009";
      insertConversation(alpha.ref(onlyOnce), { clientName: "Single" });

      const detail = await getJson(
        `/api/conversations/${onlyOnce}`,
        alphaAdmin,
      );
      expect(detail.conversation.client_name).toBe("Single");
    });

    /**
     * The dashboard's own links have to name the thread, or they land on the
     * 409 above. The order records the channel account it came in on, so the
     * order page links with both values. The test reads the link out of the
     * template and drives it through the API the way a click would.
     */
    it("the order page links to the thread the order belongs to", async () => {
      const order = createOrder({
        ref: second.ref(SHARED_PHONE),
        clientName: "Alpha Client, second number",
        clientDni: "12345678",
        products: [{ productId: "p1", name: "Terma", price: 200, quantity: 1 }],
        totalAmount: 200,
        deliveryAddress: "Lima",
      });

      const template = readFileSync(
        new URL(
          "../../frontend/src/routes/dashboard/orders/[orderId]/+page.svelte",
          import.meta.url,
        ),
        "utf-8",
      );

      const href = /href="(\/dashboard\/conversations\/[^"]+)"/.exec(
        template,
      )?.[1];
      expect(href).toBeDefined();

      const link = href!
        .replaceAll("{order.conversation_phone}", order.conversation_phone)
        .replaceAll("{order.channel_account_id}", order.channel_account_id);

      // Every placeholder in the template is one of the two above.
      expect(link).not.toContain("{");

      const response = await get(
        link.replace("/dashboard/conversations/", "/api/conversations/"),
        alphaAdmin,
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        conversation: { channel_account_id: string };
      };
      expect(body.conversation.channel_account_id).toBe(
        second.channelAccountId,
      );
    });
  });

  /**
   * The tenant's own status is re-read on every request, like membership. A
   * session pinned before the suspension must lose read and write access at
   * once instead of keeping it for the rest of its lifetime.
   */
  describe("suspending a tenant", () => {
    function suspend(tenantId: string): void {
      db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(
        tenantId,
      );
    }

    it("cuts off a session that was already acting in it", async () => {
      expect((await get("/api/conversations", alphaAdmin)).status).toBe(200);

      suspend(alpha.tenantId);

      const response = await get("/api/conversations", alphaAdmin);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: "No active tenant",
      });
    });

    it("stops writes as well as reads", async () => {
      suspend(alpha.tenantId);

      const response = await app.request("/api/orders", {
        method: "POST",
        headers: {
          Cookie: alphaAdmin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationPhone: SHARED_PHONE,
          clientName: "Alpha Client",
          clientDni: "12345678",
          products: [],
          totalAmount: 100,
          deliveryAddress: "Lima",
        }),
      });

      expect(response.status).toBe(403);
    });

    it("drops the pin rather than the session", () => {
      suspend(alpha.tenantId);

      const { session, user } = validateSessionToken(alphaAdmin.token);

      // Still logged in but acting nowhere. The user can select another
      // tenant, exactly as when a membership is revoked.
      expect(session).not.toBeNull();
      expect(user?.activeTenantId).toBeNull();
    });

    it("leaves the other tenant working", async () => {
      suspend(alpha.tenantId);

      expect((await get("/api/conversations", betaAdmin)).status).toBe(200);
    });

    /**
     * Dropping the pin is enough only for a member, for whom no pin means no
     * access. For a platform operator, no pin is the unrestricted cross-tenant
     * view, so the read paths must exclude suspended tenants themselves. These
     * tests use an operator who never pinned anything.
     */
    describe("and an unpinned platform operator", () => {
      let operator: { cookie: string; token: string };

      beforeEach(() => {
        operator = login(createUser({ isPlatformOperator: true }), null);
      });

      function tenantsInList(rows: Array<{ tenant_id: string }>): string[] {
        return rows.map((row) => row.tenant_id);
      }

      it("no longer lists the suspended tenant's conversations", async () => {
        const before = await getJson<Array<{ tenant_id: string }>>(
          "/api/conversations",
          operator,
        );
        expect(tenantsInList(before)).toContain(alpha.tenantId);

        suspend(alpha.tenantId);

        const after = await getJson<Array<{ tenant_id: string }>>(
          "/api/conversations",
          operator,
        );
        expect(tenantsInList(after)).not.toContain(alpha.tenantId);
        // One business is closed, not the operator's view of the rest.
        expect(tenantsInList(after)).toContain(beta.tenantId);
      });

      it("no longer resolves one of its conversations by phone number", async () => {
        // Both tenants have this contact, so the unpinned lookup is ambiguous.
        // Once alpha is suspended only beta's thread remains, and that thread
        // must come back rather than whichever was touched last.
        expect(
          (await get(`/api/conversations/${SHARED_PHONE}`, operator)).status,
        ).toBe(409);

        suspend(alpha.tenantId);

        const response = await get(
          `/api/conversations/${SHARED_PHONE}`,
          operator,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          conversation: { tenant_id: beta.tenantId },
        });
      });

      it("no longer returns its LLM error traces", async () => {
        // Written directly: `trackLLMCall` writes on a detached promise, and
        // the point here is the read, not the write.
        for (const fixture of [alpha, beta]) {
          db.prepare(
            `INSERT INTO llm_calls
               (id, tenant_id, channel_account_id, phone_number, operation,
                model, prompt, user_message, status, error_message)
             VALUES (?, ?, ?, ?, 'classify', 'test', 'p', 'u', 'error', ?)`,
          ).run(
            crypto.randomUUID(),
            fixture.tenantId,
            fixture.channelAccountId,
            SHARED_PHONE,
            `${fixture.tenantId} blew up`,
          );
        }

        const before = await getJson<{
          errors: Array<{ error_message: string }>;
        }>("/api/admin/llm-errors", operator);
        expect(before.errors.map((e) => e.error_message)).toContain(
          `${alpha.tenantId} blew up`,
        );

        suspend(alpha.tenantId);

        const after = await getJson<{
          errors: Array<{ error_message: string }>;
        }>("/api/admin/llm-errors", operator);
        const messages = after.errors.map((e) => e.error_message);

        expect(messages).not.toContain(`${alpha.tenantId} blew up`);
        expect(messages).toContain(`${beta.tenantId} blew up`);
      });

      it("no longer serves the suspended tenant's assets", async () => {
        const asset = AssetService.create({
          tenantId: alpha.tenantId,
          kind: "catalog_image",
          visibility: "public",
          storageKey: "images/abc123def4567890.jpg",
        });

        expect((await get(`/api/assets/${asset.id}`, operator)).status).toBe(
          200,
        );

        suspend(alpha.tenantId);

        // Reported as missing rather than forbidden, the same as any asset the
        // caller may not have.
        expect((await get(`/api/assets/${asset.id}`, operator)).status).toBe(
          404,
        );
      });
    });
  });

  /**
   * A number registered before SECRETS_KEY was configured is 'pending' and has
   * no token, so it cannot send. Supplying a token through the admin API must
   * also activate the number. Otherwise it stays unusable until somebody
   * PATCHes the status separately.
   */
  describe("giving a pending number its credentials", () => {
    const TOKEN = "EAAG-admin-supplied-token";

    let savedKey: string | undefined;
    let pendingId: string;

    beforeEach(() => {
      savedKey = process.env.SECRETS_KEY;
      process.env.SECRETS_KEY = "c3".repeat(32);

      pendingId = ChannelAccountService.create({
        tenantId: alpha.tenantId,
        phoneNumberId: `pnid-${crypto.randomUUID().slice(0, 8)}`,
        label: "Segunda línea",
      }).id;

      expect(ChannelAccountService.getById(pendingId)?.status).toBe("pending");
    });

    afterEach(() => {
      if (savedKey === undefined) {
        delete process.env.SECRETS_KEY;
      } else {
        process.env.SECRETS_KEY = savedKey;
      }
    });

    it("activates the number the token arrives on", async () => {
      const response = await patch(
        `/api/admin/channels/${pendingId}`,
        alphaAdmin,
        { accessToken: TOKEN },
      );

      expect(response.status).toBe(200);
      expect(((await response.json()) as { status: string }).status).toBe(
        "active",
      );

      const account = ChannelAccountService.getById(pendingId)!;
      expect(account.status).toBe("active");
      expect(ChannelAccountService.getAccessToken(account)).toBe(TOKEN);
    });

    it("still honours a status the request names", async () => {
      const response = await patch(
        `/api/admin/channels/${pendingId}`,
        alphaAdmin,
        { accessToken: TOKEN, status: "disabled" },
      );

      expect(((await response.json()) as { status: string }).status).toBe(
        "disabled",
      );
    });

    it("does not bring a disabled number back", async () => {
      ChannelAccountService.updateStatus(pendingId, "disabled");

      await patch(`/api/admin/channels/${pendingId}`, alphaAdmin, {
        accessToken: TOKEN,
      });

      expect(ChannelAccountService.getById(pendingId)?.status).toBe("disabled");
    });

    it("does not touch another tenant's number", async () => {
      const response = await patch(
        `/api/admin/channels/${pendingId}`,
        betaAdmin,
        { accessToken: TOKEN },
      );

      expect(response.status).toBe(404);
      expect(ChannelAccountService.getById(pendingId)?.status).toBe("pending");
    });

    /**
     * An account with no token must not become 'active'. Webhook intake accepts
     * inbound messages for any active account, and the outbound adapter refuses
     * to send without credentials. Such a number would consume customer
     * messages it can never answer. 'pending' is the state for exactly this.
     */
    describe("activating a number that cannot send", () => {
      it("refuses the transition when no token is stored", async () => {
        const response = await patch(
          `/api/admin/channels/${pendingId}`,
          alphaAdmin,
          { status: "active" },
        );

        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: string }).error).toContain(
          "access token",
        );
      });

      it("leaves the account exactly as it was", async () => {
        await patch(`/api/admin/channels/${pendingId}`, alphaAdmin, {
          status: "active",
        });

        expect(ChannelAccountService.getById(pendingId)?.status).toBe(
          "pending",
        );
      });

      it("does not half-apply the rest of the request", async () => {
        // The verify token is written before the status in the handler's own
        // order, so a refusal decided afterwards would leave it stored.
        await patch(`/api/admin/channels/${pendingId}`, alphaAdmin, {
          verifyToken: "verify-me",
          status: "active",
        });

        expect(
          ChannelAccountService.getById(pendingId)?.verify_token_secret_id,
        ).toBeNull();
      });

      it("allows it when the token arrives in the same request", async () => {
        const response = await patch(
          `/api/admin/channels/${pendingId}`,
          alphaAdmin,
          { accessToken: TOKEN, status: "active" },
        );

        expect(response.status).toBe(200);
        expect(((await response.json()) as { status: string }).status).toBe(
          "active",
        );
      });

      it("allows it when one is already stored", async () => {
        // Disabled by a person, then turned back on: the credential is there,
        // and this is the ordinary re-enable.
        ChannelAccountService.setAccessToken(pendingId, TOKEN);
        ChannelAccountService.updateStatus(pendingId, "disabled");

        const response = await patch(
          `/api/admin/channels/${pendingId}`,
          alphaAdmin,
          { status: "active" },
        );

        expect(response.status).toBe(200);
        expect(ChannelAccountService.getById(pendingId)?.status).toBe("active");
      });

      it("still lets it be parked in a state it can honour", async () => {
        for (const status of ["pending", "disabled"] as const) {
          const response = await patch(
            `/api/admin/channels/${pendingId}`,
            alphaAdmin,
            { status },
          );

          expect(response.status).toBe(200);
          expect(ChannelAccountService.getById(pendingId)?.status).toBe(status);
        }
      });
    });
  });

  /**
   * A member with no pinned tenant is reported with a null role, not "admin".
   * A platform operator is admin in every scope. Login in routes/auth.ts and
   * `validateSessionToken` both derive the role from `sessionRole`. A member of
   * two tenants starts unpinned.
   */
  describe("an unpinned member is not reported as an admin", () => {
    let agentId: string;
    let agentSession: { cookie: string; token: string };

    beforeEach(() => {
      agentId = createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
      });
      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'sales_agent')`,
      ).run(crypto.randomUUID(), beta.tenantId, agentId);

      // A member of two tenants starts unpinned, which is the case at issue.
      expect(MembershipService.listForUser(agentId)).toHaveLength(2);
      expect(defaultTenantForUser(agentId, false)).toBeNull();

      agentSession = login(agentId, null);
    });

    it("reports no role at all while unpinned", () => {
      expect(
        sessionRole({ isPlatformOperator: false, membershipRole: null }),
      ).toBeNull();

      const { user } = validateSessionToken(agentSession.token);
      expect(user?.role).toBeNull();
      expect(user?.activeTenantId).toBeNull();
      expect(user?.isPlatformOperator).toBe(false);
    });

    it("reports the membership role once a tenant is picked", async () => {
      const picked = await app.request("/api/tenants/active", {
        method: "POST",
        headers: {
          Cookie: agentSession.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: alpha.tenantId }),
      });
      expect(picked.status).toBe(200);

      const { user } = validateSessionToken(agentSession.token);
      expect(user?.role).toBe("sales_agent");
    });

    it("still reports admin for a platform operator", () => {
      const operator = login(createUser({ isPlatformOperator: true }), null);
      const { user } = validateSessionToken(operator.token);

      expect(user?.role).toBe("admin");
      expect(user?.isPlatformOperator).toBe(true);
    });

    it("grants no admin authority while unpinned", async () => {
      expect((await get("/api/admin/users", agentSession)).status).toBe(403);
      expect((await get("/api/conversations", agentSession)).status).toBe(403);
    });

    it("is still not an admin after picking a tenant", async () => {
      await app.request("/api/tenants/active", {
        method: "POST",
        headers: {
          Cookie: agentSession.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: alpha.tenantId }),
      });

      expect((await get("/api/admin/users", agentSession)).status).toBe(403);
      expect((await get("/api/conversations", agentSession)).status).toBe(200);
    });
  });

  /**
   * A platform operator can also hold an ordinary membership in the tenant
   * they are pinned to. Their authority there is still the operator's, both in
   * what they are told and in what the role gates let through.
   */
  describe("a platform operator who is also a member of the pinned tenant", () => {
    let operatorSession: { cookie: string; token: string };

    beforeEach(() => {
      const operatorId = createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
        isPlatformOperator: true,
      });
      operatorSession = login(operatorId, alpha.tenantId);
    });

    it("is reported as an admin", () => {
      const { user, scope } = validateSessionToken(operatorSession.token);

      expect(scope?.tenantId).toBe(alpha.tenantId);
      expect(user?.role).toBe("admin");
    });

    it("holds admin authority in the role check", () => {
      const { scope } = validateSessionToken(operatorSession.token);
      if (!scope) throw new Error("The operator's session did not validate");

      expect(hasRole(scope, ["admin"])).toBe(true);
    });

    it("is let through an admin-gated route", async () => {
      expect((await get("/api/admin/users", operatorSession)).status).toBe(200);
    });
  });

  /**
   * `_effective_maintenance_mode` reports the effective freeze, and the write
   * path skips it. The writable `maintenance_mode` holds only the tenant's own
   * value, so a save cannot persist a platform freeze as the tenant's own. A
   * tenant's row must not hide a platform freeze either.
   */
  describe("a platform freeze and a tenant's own setting stay separate", () => {
    afterEach(() => {
      db.prepare(
        "DELETE FROM system_settings WHERE key = 'maintenance_mode'",
      ).run();
    });

    it("reports the freeze even when the tenant says otherwise", async () => {
      SystemSettings.set("maintenance_mode", "true");
      TenantSettings.set(alpha.tenantId, "maintenance_mode", "false");

      const settings = await getJson<Record<string, string>>(
        "/api/admin/settings",
        alphaAdmin,
      );

      // The endpoint reports the platform freeze that holds the bot.
      expect(settings._effective_maintenance_mode).toBe("true");
      expect(settings._platform_maintenance_mode).toBe("true");
      // The writable field does not claim the tenant asked for it.
      expect(settings.maintenance_mode).toBe("false");
    });

    it("reports a tenant-only freeze too", async () => {
      TenantSettings.set(alpha.tenantId, "maintenance_mode", "true");

      const settings = await getJson<Record<string, string>>(
        "/api/admin/settings",
        alphaAdmin,
      );

      expect(settings._effective_maintenance_mode).toBe("true");
      expect(settings._platform_maintenance_mode).toBe("false");
      expect(settings.maintenance_mode).toBe("true");
    });

    it("reports live only when neither level holds", async () => {
      const settings = await getJson<Record<string, string>>(
        "/api/admin/settings",
        alphaAdmin,
      );

      expect(settings._effective_maintenance_mode).toBe("false");
      // Absent, not "false": this tenant has never stored one, and a key it
      // never set is a key its next save cannot write back.
      expect(settings.maintenance_mode).toBeUndefined();
    });

    it("never reports the platform's freeze in the writable field", async () => {
      SystemSettings.set("maintenance_mode", "true");
      // No tenant row at all, which is the ordinary case: the tenant has never
      // touched its own toggle.
      expect(TenantSettings.get(alpha.tenantId, "maintenance_mode")).toBeNull();

      const settings = await getJson<Record<string, string>>(
        "/api/admin/settings",
        alphaAdmin,
      );

      expect(settings.maintenance_mode).toBeUndefined();
    });

    /**
     * A platform freeze persisted as the tenant's own outlives the platform one
     * and leaves the business frozen for no visible reason. The tests drive the
     * dashboard's flow: load the page, change an unrelated setting, save the
     * whole object back.
     */
    describe("saving an unrelated setting during a platform freeze", () => {
      async function loadChangeAndSave(change: Record<string, string>) {
        const loaded = await getJson<Record<string, string>>(
          "/api/admin/settings",
          alphaAdmin,
        );

        return app.request("/api/admin/settings", {
          method: "POST",
          headers: {
            Cookie: alphaAdmin.cookie,
            "Content-Type": "application/json",
          },
          // The page posts everything it was handed except keys that start with
          // "_", with the one field the admin touched changed. This helper keeps
          // those keys too, and the server skips them anyway.
          body: JSON.stringify({ ...loaded, ...change }),
        });
      }

      beforeEach(() => {
        SystemSettings.set("maintenance_mode", "true");
      });

      it("leaves the tenant with no maintenance setting of its own", async () => {
        expect(
          TenantSettings.get(alpha.tenantId, "maintenance_mode"),
        ).toBeNull();

        const response = await loadChangeAndSave({ business_name: "Gas Perú" });
        expect(response.status).toBe(200);

        // The tenant keeps no maintenance row of its own, so lifting the
        // platform freeze leaves it unfrozen.
        expect(
          TenantSettings.get(alpha.tenantId, "maintenance_mode"),
        ).toBeNull();
      });

      it("does not flip a tenant that had deliberately set it false", async () => {
        TenantSettings.set(alpha.tenantId, "maintenance_mode", "false");

        await loadChangeAndSave({ business_name: "Gas Perú" });

        expect(TenantSettings.get(alpha.tenantId, "maintenance_mode")).toBe(
          "false",
        );
      });

      it("still saves the setting the admin actually changed", async () => {
        await loadChangeAndSave({ business_name: "Gas Perú" });

        expect(TenantSettings.get(alpha.tenantId, "business_name")).toBe(
          "Gas Perú",
        );
      });

      it("leaves the business unfrozen once the platform freeze lifts", async () => {
        await loadChangeAndSave({ business_name: "Gas Perú" });

        db.prepare(
          "DELETE FROM system_settings WHERE key = 'maintenance_mode'",
        ).run();

        const settings = await getJson<Record<string, string>>(
          "/api/admin/settings",
          alphaAdmin,
        );

        expect(settings._effective_maintenance_mode).toBe("false");
      });

      it("still lets the tenant freeze itself on purpose", async () => {
        // The toggle has to keep working during a platform freeze. It must not
        // change on its own.
        await loadChangeAndSave({ maintenance_mode: "true" });

        expect(TenantSettings.get(alpha.tenantId, "maintenance_mode")).toBe(
          "true",
        );
      });
    });

    it("does not let a tenant admin write platform-only switches", async () => {
      const response = await app.request("/api/admin/settings", {
        method: "POST",
        headers: {
          Cookie: alphaAdmin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ force_fnb_down: "true" }),
      });

      expect(await response.json()).toMatchObject({
        rejected: ["force_fnb_down"],
      });
      expect(SystemSettings.get("force_fnb_down")).toBeNull();
    });
  });

  /**
   * A tenant admin sees only the platform values their dashboard draws. The
   * response must not include VendeYa's own deployment configuration, such as
   * `platform_ops_channel_account_id`, the channel account VendeYa's operations
   * alerts go out on.
   */
  describe("the platform values a tenant admin is shown", () => {
    const OPS_ACCOUNT_KEY = "platform_ops_channel_account_id";

    afterEach(() => {
      db.prepare("DELETE FROM system_settings").run();
    });

    it("does not include VendeYa's own deployment configuration", async () => {
      SystemSettings.set(OPS_ACCOUNT_KEY, "ch-vendeya-internal");

      const settings = await getJson<Record<string, string>>(
        "/api/admin/settings",
        alphaAdmin,
      );

      expect(settings[OPS_ACCOUNT_KEY]).toBeUndefined();
      expect(JSON.stringify(settings)).not.toContain("ch-vendeya-internal");
      expect(settings._scope).toBe("tenant");
    });

    it("still includes the switches the dashboard renders, read-only", async () => {
      SystemSettings.set("force_fnb_down", "true");
      SystemSettings.set("force_gaso_down", "false");

      const settings = await getJson<Record<string, string>>(
        "/api/admin/settings",
        alphaAdmin,
      );

      expect(settings._platform_force_fnb_down).toBe("true");
      expect(settings._platform_force_gaso_down).toBe("false");
      expect(settings._platform_maintenance_mode).toBe("false");
      // None under its own name: those are the fields a save posts back.
      expect(settings.force_fnb_down).toBeUndefined();
      expect(settings.force_gaso_down).toBeUndefined();
      expect(settings.maintenance_mode).toBeUndefined();
    });

    /**
     * The kill switches are reported under prefixed names. Under their raw names
     * the page would post them back on every save, and every save would answer
     * `rejected` for a write nobody attempted.
     */
    it("rejects nothing when the page saves back exactly what it loaded", async () => {
      SystemSettings.set("force_fnb_down", "true");
      SystemSettings.set("force_gaso_down", "false");
      TenantSettings.set(alpha.tenantId, "business_name", "Gas Perú");

      const loaded = await getJson<Record<string, string>>(
        "/api/admin/settings",
        alphaAdmin,
      );

      const response = await post("/api/admin/settings", alphaAdmin, loaded);

      expect(await response.json()).toMatchObject({
        success: true,
        rejected: [],
        updates: { business_name: "Gas Perú" },
      });
      // And the platform's values are where they were.
      expect(SystemSettings.get("force_fnb_down")).toBe("true");
    });

    /** An operator with no tenant selected owns these and sees all of them. */
    it("is not narrowed for a platform operator", async () => {
      SystemSettings.set(OPS_ACCOUNT_KEY, "ch-vendeya-internal");
      const operator = login(createUser({ isPlatformOperator: true }), null);

      const settings = await getJson<Record<string, string>>(
        "/api/admin/settings",
        operator,
      );

      expect(settings[OPS_ACCOUNT_KEY]).toBe("ch-vendeya-internal");
      expect(settings._scope).toBe("platform");
    });
  });

  /**
   * `tenant_settings` holds operator-owned settings and application-owned state
   * such as `last_agent_index`, the round-robin cursor of
   * domains/conversations/assignment.ts. A tenant admin must not write the
   * cursor, because the application reads it back as its own state.
   */
  describe("settings the application owns, not the operator", () => {
    const ROUND_ROBIN_KEY = "last_agent_index";

    function writeSettings(body: unknown) {
      return app.request("/api/admin/settings", {
        method: "POST",
        headers: {
          Cookie: alphaAdmin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }

    it("refuses a tenant admin writing the round-robin cursor", async () => {
      TenantSettings.set(alpha.tenantId, ROUND_ROBIN_KEY, "2");

      const response = await writeSettings({ [ROUND_ROBIN_KEY]: "invalid" });

      expect(await response.json()).toMatchObject({
        rejected: [ROUND_ROBIN_KEY],
        updates: {},
      });
      expect(TenantSettings.get(alpha.tenantId, ROUND_ROBIN_KEY)).toBe("2");
    });

    it("still takes the operator-owned keys in the same request", async () => {
      const response = await writeSettings({
        [ROUND_ROBIN_KEY]: "invalid",
        whatsapp_group_sales: "51900000000",
      });

      expect(await response.json()).toMatchObject({
        rejected: [ROUND_ROBIN_KEY],
        updates: { whatsapp_group_sales: "51900000000" },
      });
      expect(TenantSettings.get(alpha.tenantId, ROUND_ROBIN_KEY)).toBeNull();
    });

    /**
     * The dashboard posts back whatever the GET handed it, so a key it can see
     * is a key it resubmits on every save.
     */
    it("keeps it out of what the settings endpoint reports", async () => {
      TenantSettings.set(alpha.tenantId, ROUND_ROBIN_KEY, "2");
      TenantSettings.set(alpha.tenantId, "whatsapp_group_dev", "51900000001");

      const settings = await getJson<Record<string, string>>(
        "/api/admin/settings",
        alphaAdmin,
      );

      expect(settings[ROUND_ROBIN_KEY]).toBeUndefined();
      expect(settings.whatsapp_group_dev).toBe("51900000001");
    });

    /**
     * Defence in depth for a row edited straight in the database. NaN survives
     * the modulo and is written back, so one bad read would otherwise poison
     * every assignment that followed.
     */
    it("assigns an agent even with a corrupt cursor already stored", async () => {
      TenantSettings.set(alpha.tenantId, ROUND_ROBIN_KEY, "invalid");

      const agentId = createUser({
        tenantId: alpha.tenantId,
        role: "sales_agent",
      });

      const assigned = await assignNextAgent(
        alpha.ref(SHARED_PHONE),
        "Alpha Client",
      );

      expect(assigned).toBe(agentId);
      expect(TenantSettings.get(alpha.tenantId, ROUND_ROBIN_KEY)).toBe("0");
    });
  });

  /**
   * `requireTenantScope` lets an unpinned platform operator through to read
   * across tenants. The conversation write routes also take
   * `requireActiveTenant`, so an operator with no tenant selected cannot write
   * to another business's conversations.
   */
  describe("an unpinned platform operator cannot write", () => {
    const BETA_ONLY = "51900000002";
    let operator: { cookie: string };

    beforeEach(() => {
      operator = login(createUser({ isPlatformOperator: true }), null);
      insertConversation(beta.ref(BETA_ONLY), { clientName: "Beta Only" });
    });

    function conversationRow(phone: string, tenantId: string) {
      return db
        .prepare(
          `SELECT status, assigned_agent, agent_notes FROM conversations
           WHERE tenant_id = ? AND phone_number = ?`,
        )
        .get(tenantId, phone) as {
        status: string;
        assigned_agent: string | null;
        agent_notes: string | null;
      };
    }

    function write(
      path: string,
      auth: { cookie: string },
      init: RequestInit = {},
    ) {
      return app.request(`/api/conversations/${BETA_ONLY}${path}`, {
        method: "POST",
        headers: { Cookie: auth.cookie, "Content-Type": "application/json" },
        ...init,
      });
    }

    it("refuses every write route with no tenant selected", async () => {
      const responses = await Promise.all([
        write("/takeover", operator),
        write("/message", operator, {
          body: JSON.stringify({ content: "hola" }),
        }),
        write("/release", operator),
        write("/decline-assignment", operator),
        write("/agent-data", operator, {
          method: "PATCH",
          body: JSON.stringify({ agentNotes: "written from nowhere" }),
        }),
        write("/upload-contract", operator, { body: new FormData() }),
      ]);

      expect(responses.map((r) => r.status)).toEqual([
        403, 403, 403, 403, 403, 403,
      ]);
      expect(await responses[0]!.json()).toMatchObject({
        error: "No active tenant",
      });
    });

    it("leaves the other tenant's conversation untouched", async () => {
      const before = conversationRow(BETA_ONLY, beta.tenantId);

      await write("/takeover", operator);
      await write("/agent-data", operator, {
        method: "PATCH",
        body: JSON.stringify({ agentNotes: "written from nowhere" }),
      });

      expect(conversationRow(BETA_ONLY, beta.tenantId)).toEqual(before);
    });

    it("still reads across tenants while unpinned", async () => {
      const detail = await getJson(`/api/conversations/${BETA_ONLY}`, operator);
      expect(detail.conversation.client_name).toBe("Beta Only");
    });

    it("writes once a tenant is pinned", async () => {
      const picked = await app.request("/api/tenants/active", {
        method: "POST",
        headers: {
          Cookie: operator.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: beta.tenantId }),
      });
      expect(picked.status).toBe(200);

      expect((await write("/takeover", operator)).status).toBe(200);
      expect(conversationRow(BETA_ONLY, beta.tenantId).status).toBe(
        "human_takeover",
      );
    });

    it("refuses a tenant member who has not picked one either", async () => {
      const inBoth = createUser({ tenantId: alpha.tenantId });
      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'admin')`,
      ).run(crypto.randomUUID(), beta.tenantId, inBoth);

      const unpinned = login(inBoth, null);

      expect((await write("/takeover", unpinned)).status).toBe(403);
    });
  });

  /**
   * `writeTenantId` is the invariant behind both `requireActiveTenant` and
   * `activeTenantId`. A route that reads the active tenant without the
   * middleware in front of it is a bug, and this is what it costs: the request
   * is refused, not served with an unscoped write.
   */
  describe("a route that forgets requireActiveTenant", () => {
    function appWithUnguardedWrite() {
      const unguarded = new Hono();
      unguarded.onError(errorHandler);
      unguarded.use("/api/*", requireAuth);
      unguarded.post("/api/unguarded", (c) =>
        c.json({ tenantId: activeTenantId(c) }),
      );
      return unguarded;
    }

    function post(auth: { cookie: string }) {
      return appWithUnguardedWrite().request("/api/unguarded", {
        method: "POST",
        headers: { Cookie: auth.cookie },
      });
    }

    it("refuses an unpinned caller instead of failing open", async () => {
      const operator = login(createUser({ isPlatformOperator: true }), null);

      const response = await post(operator);

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: "No active tenant",
      });
    });

    it("still answers a pinned one", async () => {
      const response = await post(alphaAdmin);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ tenantId: alpha.tenantId });
    });
  });

  describe("tenant selection", () => {
    async function selectTenant(auth: { cookie: string }, tenantId: unknown) {
      return app.request("/api/tenants/active", {
        method: "POST",
        headers: { Cookie: auth.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
    }

    it("refuses a tenant the caller does not belong to", async () => {
      const response = await selectTenant(alphaAdmin, beta.tenantId);

      expect(response.status).toBe(404);

      // The session is untouched: still reading alpha.
      const rows = await getJson<Array<{ tenant_id: string }>>(
        "/api/conversations",
        alphaAdmin,
      );
      expect(
        rows.every(
          (r: { tenant_id: string }) => r.tenant_id === alpha.tenantId,
        ),
      ).toBe(true);
    });

    it("lets a member switch between their own tenants", async () => {
      const userId = createUser({ tenantId: alpha.tenantId });
      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'admin')`,
      ).run(crypto.randomUUID(), beta.tenantId, userId);

      const session = login(userId, alpha.tenantId);

      const listed = await getJson<{ tenants: unknown[] }>(
        "/api/tenants",
        session,
      );
      expect(listed.tenants).toHaveLength(2);

      expect((await selectTenant(session, beta.tenantId)).status).toBe(200);

      const detail = await getJson(
        `/api/conversations/${SHARED_PHONE}`,
        session,
      );
      expect(detail.conversation.client_name).toBe("Beta Client");
    });

    it("lets a platform operator pin to a tenant and unpin again", async () => {
      const operator = login(createUser({ isPlatformOperator: true }), null);

      // Unpinned: reads span tenants.
      const across = await getJson<Array<{ tenant_id: string }>>(
        "/api/conversations",
        operator,
      );
      const tenantIds = new Set(across.map((r) => r.tenant_id));
      expect(tenantIds.has(alpha.tenantId)).toBe(true);
      expect(tenantIds.has(beta.tenantId)).toBe(true);

      // Pinned to a tenant they are not a member of, which support requires.
      expect((await selectTenant(operator, beta.tenantId)).status).toBe(200);

      const scoped = await getJson<Array<{ tenant_id: string }>>(
        "/api/conversations",
        operator,
      );
      expect(scoped.every((r) => r.tenant_id === beta.tenantId)).toBe(true);

      expect((await selectTenant(operator, null)).status).toBe(200);
    });

    it("refuses to unpin a tenant-side user", async () => {
      const response = await selectTenant(alphaAdmin, null);
      expect(response.status).toBe(403);
    });
  });

  /**
   * Logging in for somebody whose only business is suspended. Belonging to a
   * suspended tenant is still belonging, so login succeeds and hands out the
   * unpinned session. That matches a session already held through the
   * suspension, which `validateSessionToken` keeps and unpins.
   */
  describe("logging in", () => {
    const PASSWORD = "the-right-password";

    function userWithPassword(tenantId?: string): string {
      const userId = createUser({ tenantId });
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
        bcrypt.hashSync(PASSWORD, 4),
        userId,
      );
      return userId;
    }

    function logIn(userId: string, password = PASSWORD) {
      const { username } = db
        .prepare("SELECT username FROM users WHERE id = ?")
        .get(userId) as { username: string };

      return app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
    }

    function suspend(tenantId: string): void {
      db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(
        tenantId,
      );
    }

    it("pins a member to their one open business", async () => {
      const response = await logIn(userWithPassword(alpha.tenantId));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: { activeTenantId: alpha.tenantId, role: "admin" },
      });
    });

    it("lets in a member whose only business is suspended, unpinned", async () => {
      const userId = userWithPassword(alpha.tenantId);
      suspend(alpha.tenantId);

      const response = await logIn(userId);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: { activeTenantId: null, role: null },
        // Nothing they can pick, which is what the dashboard then shows.
        tenants: [],
      });

      // A real session, in the same state an existing one is left in.
      const [cookie = ""] = (response.headers.get("set-cookie") ?? "").split(
        ";",
      );
      const me = await app.request("/api/auth/me", {
        headers: { Cookie: cookie },
      });
      expect(me.status).toBe(200);
      expect(await me.json()).toMatchObject({
        user: { id: userId, activeTenantId: null },
      });

      // And no way to act in the suspended business through it.
      expect(
        (
          await app.request("/api/conversations", {
            headers: { Cookie: cookie },
          })
        ).status,
      ).toBe(403);
    });

    it("still refuses their wrong password", async () => {
      const userId = userWithPassword(alpha.tenantId);
      suspend(alpha.tenantId);

      expect((await logIn(userId, "not-the-password")).status).toBe(401);
    });

    it("still refuses somebody who belongs to no business at all", async () => {
      expect((await logIn(userWithPassword())).status).toBe(401);
    });
  });

  /**
   * The account is shaped like a migrated admin after `bun run account promote`:
   * it keeps its membership and is also platform staff. An upgraded
   * single-business deployment has no operator until one is promoted, so the
   * flag alone must be enough to create a tenant.
   */
  describe("creating the second tenant", () => {
    const slug = "second-business";

    afterEach(() => {
      db.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
    });

    it("is what the platform operator flag buys a migrated admin", async () => {
      const operator = login(
        createUser({ tenantId: alpha.tenantId, isPlatformOperator: true }),
        alpha.tenantId,
      );

      const response = await post("/api/tenants", operator, {
        slug,
        name: "Second Business",
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        slug,
        name: "Second Business",
        status: "active",
      });
    });

    it("is closed to the same admin without it", async () => {
      const admin = login(
        createUser({ tenantId: alpha.tenantId }),
        alpha.tenantId,
      );

      const response = await post("/api/tenants", admin, {
        slug,
        name: "Second Business",
      });

      expect(response.status).toBe(403);
    });
  });
});

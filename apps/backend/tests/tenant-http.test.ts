/**
 * Authorization at the HTTP layer.
 *
 * These drive the real routers behind the real `requireAuth` middleware with a
 * real session cookie, so what is tested is what a request actually meets:
 * session -> tenant scope -> route. `src/index.ts` is not imported because it
 * starts the aggregator worker and reassignment timers on import; the routers
 * and middleware it mounts are the parts under test.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import process from "node:process";
import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { db } from "../src/db/index.ts";
import type { Bundle } from "@totem/types";

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
  // Ahead of the global requireAuth, as index.ts mounts it: logging in is the
  // one thing done without a session.
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

  /** GET a path and read the JSON body, which these tests always know the shape of. */
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
   * Bundle writes take a raw request body. Both routes hand `await
   * c.req.json()` to the service as `updates`, so the service - not the type -
   * decides which columns a client may reach. `tenant_id` is the one that
   * matters: the UPDATE's WHERE matches on the row's current tenant, so
   * writing a new `tenant_id` in the SET would succeed and move the row to
   * another business. Off-list keys are dropped, and the allowlisted fields in
   * the same body still apply.
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

    // Every other off-list column is dropped the same way.
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
   * The way out of that state, for a user who was in two tenants and is now in
   * one. Dropping the pin is correct, but it leaves them unpinned with a single
   * membership, and every tenant-scoped page 403s until they pin it. The API
   * has always allowed exactly that; the dashboard hid the selector unless the
   * user had *more than one* tenant to choose between, so this was reachable
   * only by logging out and back in (see the frontend's showTenantSelector).
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

    // Unpinned, one membership left - and it is still listed, which is what the
    // selector is populated from.
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
   * `users.username` is one namespace across the platform because login is
   * username + password with no business to pick first. A tenant admin choosing
   * a name therefore learns whether it is free, and nothing can change that -
   * it is what a unique constraint is.
   *
   * What they must not learn is anything beyond availability. Answering
   * "Username already exists" told a tenant B admin that an account by that
   * name existed *somewhere on VendeYa*, which the constraint never had to give
   * away. Both cases answer identically now, so probing distinguishes nothing.
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

      // Byte-identical: the response is not an oracle for cross-tenant
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
   * Regression: `password_hash` lives on the global user record, so resetting it
   * for a user who also belongs to another tenant handed the acting admin that
   * user's access everywhere - a cross-tenant account takeover.
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
   * Regression: `is_active` is on the global user record too, so deactivating a
   * user who also belongs to another tenant locked them out of that other
   * business as a side effect of an admin acting in this one. Same shape as the
   * password reset above, same rule.
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
   * Regression: a conversation is (tenant, channel account, phone number), but
   * `:phone` alone used to resolve to whichever thread was most recently active,
   * silently conflating a contact who writes to two of the tenant's numbers.
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
     * 409 above. The order page linked by phone number alone, so its "Ver
     * conversación" was dead for any tenant with a second number - and the
     * order knows which number it came in on. The link is read out of the
     * template and driven through the API the way a click would drive it.
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
   * Regression: membership was re-read on every request but the tenant's own
   * status never was, so suspending a business only stopped new sessions from
   * pinning it. Every session pinned beforehand kept full read and write access
   * for as long as it lived - up to thirty days.
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

      // Still logged in, no longer acting anywhere: the user can select another
      // tenant, exactly as when a membership is revoked.
      expect(session).not.toBeNull();
      expect(user?.activeTenantId).toBeNull();
    });

    it("leaves the other tenant working", async () => {
      suspend(alpha.tenantId);

      expect((await get("/api/conversations", betaAdmin)).status).toBe(200);
    });

    /**
     * Dropping the pin is the whole of the fix only for a member, for whom no
     * pin means no access at all. For a platform operator, no pin *is* the
     * unrestricted cross-tenant view - so unpinning a suspended tenant handed
     * back exactly the access suspension was meant to take away, and the
     * suspended business stayed just as readable as before. These go through
     * an operator who never pinned anything.
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
        // Both tenants have this contact, so unpinned the lookup is ambiguous.
        // Once alpha is closed only beta's thread is left to find, and it is
        // beta's that comes back - not whichever was touched last.
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
   * Regression: a number registered before SECRETS_KEY was configured is
   * 'pending' - it has no token, so it cannot send. Handing it one through the
   * admin API stored the credential but left the status alone, so the number
   * stayed unusable until somebody thought to PATCH the status separately.
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
     * Regression: the status could be set to 'active' on an account with no
     * token at all. Webhook intake accepts inbound messages for any active
     * account, and the outbound adapter refuses to send without credentials -
     * so the number consumed customer messages it could never answer, silently
     * and indefinitely. 'pending' is the state that means exactly this.
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
   * Regression: the reported role was hardcoded to "admin" whenever no tenant
   * was pinned - exactly the case for a member of two tenants - so a sales agent
   * was announced to the dashboard as an admin before picking a business.
   *
   * The login handler in index.ts and `validateSessionToken` (which answers
   * /api/auth/me) both derive the reported role from `sessionRole`, so that
   * helper and the session payload are what these assert on.
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
   * Two regressions on one endpoint, pulling in opposite directions.
   *
   * The first: tenant settings were spread over platform settings, so a tenant
   * row named `maintenance_mode` hid a platform-wide freeze and the endpoint
   * reported the bot as live while messages were being held. The fix reported
   * the *effective* state - either level holding - in `maintenance_mode`.
   *
   * The second, which that fix caused: the dashboard posts this whole response
   * back on every save, and `maintenance_mode` is the one platform-shaped key a
   * tenant is allowed to write. So a platform-wide freeze arrived as
   * `maintenance_mode: "true"`, and the next save of any unrelated setting
   * persisted it as that tenant's own freeze - which outlived the platform one
   * and left the business permanently frozen for no visible reason.
   *
   * Both hold now because the two facts have separate names: the writable
   * `maintenance_mode` is the tenant's own stored value, and the effective
   * state is informational, under a key the write path skips.
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

      // The bot is held, and the endpoint says so - the first regression.
      expect(settings._effective_maintenance_mode).toBe("true");
      expect(settings._platform_maintenance_mode).toBe("true");
      // ...without claiming the tenant asked for it - the second.
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
     * The lockout itself, driven the way the dashboard drives it: load the
     * page, change something unrelated, save the whole object back.
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
          // Exactly what the page posts: everything it was handed, with the
          // one field the admin actually touched changed.
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

        // The whole bug in one assertion: this used to come back "true", and
        // stayed "true" after the platform freeze was lifted.
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
        // The toggle has to keep working during a platform freeze; what must
        // not happen is it moving on its own.
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
   * The platform side of the same endpoint. Its docstring always said a tenant
   * admin sees platform values so their dashboard can show a freeze, but the
   * handler spread all of SystemSettings into the response - including
   * `platform_ops_channel_account_id`, the channel account VendeYa's own
   * operations alerts go out on, which no tenant UI renders and no tenant is
   * entitled to. What a tenant sees is now the allowlist their dashboard
   * actually draws.
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
     * Regression: the kill switches came back under their raw names, so the
     * page posted them back on every save and every save was answered
     * `rejected: ["force_fnb_down", "force_gaso_down"]` - a refusal of a write
     * nobody attempted, on the channel meant to report real ones.
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
   * `tenant_settings` is a bare key/value table holding two unrelated things:
   * settings a human operator owns, and state the application writes and reads
   * back as its own. The write path guarded only the first distinction - which
   * level owns a key - so anything not on the platform list went straight in,
   * `last_agent_index` among them: the round-robin cursor of
   * domains/conversations/assignment.ts, which parsed it back with no guard.
   * One admin POST of a non-numeric value made every subsequent index NaN, so
   * the tenant silently stopped assigning agents and every handoff stalled,
   * with a warn-level log line as the only sign of it.
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
     * Defence in depth for a row written before the guard existed, or edited
     * straight in the database: NaN survives the modulo and is written back, so
     * one bad read would otherwise poison every assignment that followed.
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
   * Regression: `requireTenantScope` lets an unpinned platform operator through
   * so support can read across tenants, and the write routes below leaned on
   * that same gate. An operator with no tenant selected could therefore resolve
   * another business's conversation and mutate it - which is exactly what
   * `writeTenantId` says must not happen. Writes now take `requireActiveTenant`
   * as well: pick the tenant you are acting in first.
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
   * Logging in, for somebody whose only business has been suspended.
   *
   * The membership check at login counted active tenants only, so this user
   * was told "Invalid credentials" for the right password - while a session
   * they already held survived the same suspension (validateSessionToken keeps
   * it and drops the pin). Login now agrees with that: belonging to a suspended
   * tenant is still belonging, and the session it hands out is the unpinned one.
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
   * The end of the migration path: onboarding the second business.
   *
   * The account shape here is the one the migration produces - a tenant admin
   * who keeps the membership they already had and is also platform staff -
   * because that is the only kind of operator an upgraded single-business
   * deployment has. If the flag on its own were not enough to reach this
   * route, promoting somebody during the migration would have bought nothing.
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

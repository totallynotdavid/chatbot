/** The admin create and reset routes enforce `MIN_PASSWORD_LENGTH`. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { db } from "../src/db/index.ts";
import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { MIN_PASSWORD_LENGTH } from "../src/domains/accounts/index.ts";
import { requireAuth, requireRole } from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import adminUserRoutes from "../src/routes/admin/users.ts";

function buildApp() {
  const app = new Hono();
  app.use("/api/*", requireAuth);
  app.use("/api/admin/*", requireRole("admin"));
  app.route("/api/admin/users", adminUserRoutes);
  app.onError(errorHandler);
  return app;
}

describe("the password minimum on the admin user routes", () => {
  let app: ReturnType<typeof buildApp>;
  let tenant: TenantFixture;
  let cookie: string;

  const exactlyMinimum = "x".repeat(MIN_PASSWORD_LENGTH);
  const oneShort = "x".repeat(MIN_PASSWORD_LENGTH - 1);

  beforeEach(() => {
    applySchema();
    app = buildApp();
    tenant = createTenantFixture("password-minimum");

    const admin = createMember(tenant, "admin");
    const token = generateSessionToken();
    createSession(token, admin.userId, tenant.tenantId);
    cookie = `session=${token}`;
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  function create(username: string, password: unknown) {
    return app.request("/api/admin/users", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        role: "sales_agent",
        name: "Nuevo",
      }),
    });
  }

  function reset(userId: string, newPassword: unknown) {
    return app.request(`/api/admin/users/${userId}/password`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
  }

  function userNamed(username: string) {
    return db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(username) as { id: string } | null;
  }

  function hashOf(userId: string): string {
    return (
      db
        .prepare("SELECT password_hash FROM users WHERE id = ?")
        .get(userId) as { password_hash: string }
    ).password_hash;
  }

  describe("creating a user", () => {
    it("refuses a password one character short, with the rule in the message", async () => {
      const username = `short-${crypto.randomUUID().slice(0, 8)}`;

      const response = await create(username, oneShort);

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain(
        String(MIN_PASSWORD_LENGTH),
      );
      expect(userNamed(username)).toBeNull();
    });

    it("refuses a password that is not a string", async () => {
      const username = `number-${crypto.randomUUID().slice(0, 8)}`;

      expect((await create(username, 123456789012345)).status).toBe(400);
      expect(userNamed(username)).toBeNull();
    });

    it("accepts a password of exactly the minimum", async () => {
      const username = `exact-${crypto.randomUUID().slice(0, 8)}`;

      expect((await create(username, exactlyMinimum)).status).toBe(200);
      expect(userNamed(username)).not.toBeNull();
    });
  });

  describe("resetting a password", () => {
    it("refuses a password one character short, with the rule in the message", async () => {
      const member = createMember(tenant, "sales_agent").userId;
      const before = hashOf(member);

      const response = await reset(member, oneShort);

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain(
        String(MIN_PASSWORD_LENGTH),
      );
      expect(hashOf(member)).toBe(before);
    });

    it("refuses a password that is not a string", async () => {
      const member = createMember(tenant, "sales_agent").userId;
      const before = hashOf(member);

      expect((await reset(member, 123456789012345)).status).toBe(400);
      expect(hashOf(member)).toBe(before);
    });

    it("accepts a password of exactly the minimum", async () => {
      const member = createMember(tenant, "sales_agent").userId;
      const before = hashOf(member);

      expect((await reset(member, exactlyMinimum)).status).toBe(200);
      expect(hashOf(member)).not.toBe(before);
    });
  });
});

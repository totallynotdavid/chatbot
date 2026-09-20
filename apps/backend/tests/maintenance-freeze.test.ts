/**
 * Maintenance mode holds customer messages instead of answering them. The route
 * `/api/admin/process-held-messages` drains the held queue and replies to
 * customers, so the API itself must refuse it during a freeze. Hiding the
 * dashboard button does not count.
 */

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

import { requireAuth, requireRole } from "../src/middleware/auth.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import adminRoutes from "../src/routes/admin.ts";
import { holdMessage } from "../src/conversation/held-messages.ts";
import { processHeldMessages } from "../src/conversation/process-held.ts";
import {
  SystemSettings,
  TenantSettings,
} from "../src/domains/settings/system.ts";

const CUSTOMER = "51900555666";

function buildApp() {
  const app = new Hono();
  app.use("/api/*", requireAuth);
  app.use("/api/admin/*", requireRole("admin"));
  app.route("/api/admin", adminRoutes);
  return app;
}

function login(userId: string, tenantId: string | null): string {
  const token = generateSessionToken();
  createSession(token, userId, tenantId);
  return `session=${token}`;
}

/** Held rows still waiting for this tenant. */
function stillHeld(tenantId: string): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM held_messages WHERE tenant_id = ? AND processed_at IS NULL",
      )
      .get(tenantId) as { c: number }
  ).c;
}

describe("processing held messages while a freeze is on", () => {
  let app: ReturnType<typeof buildApp>;
  let alpha: TenantFixture;
  let beta: TenantFixture;
  let alphaAdmin: string;
  let operator: string;

  beforeEach(() => {
    applySchema();
    app = buildApp();

    alpha = createTenantFixture("alpha-freeze");
    beta = createTenantFixture("beta-freeze");

    alphaAdmin = login(createMember(alpha, "admin").userId, alpha.tenantId);

    const operatorId = `u-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, name, is_platform_operator)
       VALUES (?, ?, 'x', 'admin', 'Operator', 1)`,
    ).run(operatorId, `op-${operatorId.slice(2, 12)}`);

    // No tenant pinned: the cross-tenant support session.
    operator = login(operatorId, null);

    for (const fixture of [alpha, beta]) {
      holdMessage(
        fixture.ref(CUSTOMER),
        "hola",
        `wamid-${crypto.randomUUID()}`,
        1,
      );
    }
  });

  afterEach(() => {
    SystemSettings.set("maintenance_mode", "false");
    db.prepare("DELETE FROM audit_log WHERE tenant_id IS NULL").run();
    dropTenantFixture(alpha);
    dropTenantFixture(beta);
  });

  function post(path: string, cookie: string) {
    return app.request(path, { method: "POST", headers: { Cookie: cookie } });
  }

  const sweep = (cookie: string) =>
    post("/api/admin/process-held-messages", cookie);

  describe("a tenant admin whose own business is frozen", () => {
    beforeEach(() => {
      TenantSettings.set(alpha.tenantId, "maintenance_mode", "true");
    });

    it("is refused", async () => {
      const response = await sweep(alphaAdmin);

      expect(response.status).toBe(409);
      expect((await response.json()) as { error: string }).toMatchObject({
        error: "maintenance_mode",
      });
    });

    it("leaves the messages held, so nothing is lost or answered", async () => {
      await sweep(alphaAdmin);

      expect(stillHeld(alpha.tenantId)).toBe(1);
    });

    it("records nothing, because nothing happened", async () => {
      await sweep(alphaAdmin);

      expect(
        db
          .prepare(
            "SELECT COUNT(*) as c FROM audit_log WHERE action = 'process_held_messages' AND tenant_id = ?",
          )
          .get(alpha.tenantId),
      ).toEqual({ c: 0 });
    });

    it("goes through again once the freeze is lifted", async () => {
      TenantSettings.set(alpha.tenantId, "maintenance_mode", "false");

      expect((await sweep(alphaAdmin)).status).toBe(200);
    });
  });

  describe("a platform-wide freeze", () => {
    beforeEach(() => {
      SystemSettings.set("maintenance_mode", "true");
    });

    it("refuses a tenant admin whose own setting says nothing", async () => {
      // The platform freeze holds this tenant's messages whatever the tenant
      // says, so the endpoint that would send them has to say so too.
      expect(TenantSettings.get(alpha.tenantId, "maintenance_mode")).toBeNull();

      expect((await sweep(alphaAdmin)).status).toBe(409);
      expect(stillHeld(alpha.tenantId)).toBe(1);
    });

    it("refuses the platform operator who set it, sweep and all", async () => {
      expect((await sweep(operator)).status).toBe(409);

      expect(stillHeld(alpha.tenantId)).toBe(1);
      expect(stillHeld(beta.tenantId)).toBe(1);
    });
  });

  /**
   * One business freezing itself must not stop the platform recovering every
   * other business, so the sweep skips it rather than refusing outright.
   */
  describe("a sweep across tenants where one froze itself", () => {
    beforeEach(() => {
      TenantSettings.set(beta.tenantId, "maintenance_mode", "true");
    });

    it("runs, and says how many it left alone", async () => {
      const response = await sweep(operator);

      expect(response.status).toBe(200);
      expect(
        (await response.json()) as { tenantsInMaintenance: number },
      ).toMatchObject({ tenantsInMaintenance: 1 });
    });

    it("leaves the frozen tenant's messages held", async () => {
      await sweep(operator);

      expect(stillHeld(beta.tenantId)).toBe(1);
    });

    it("writes no audit entry into the frozen tenant's trail", async () => {
      await sweep(operator);

      // An entry would claim a sweep touched a business it deliberately did not.
      expect(
        db
          .prepare(
            "SELECT COUNT(*) as c FROM audit_log WHERE action = 'process_held_messages' AND tenant_id = ?",
          )
          .get(beta.tenantId),
      ).toEqual({ c: 0 });
    });

    it("reaches the tenant that is not frozen", async () => {
      const run = await processHeldMessages(null);

      expect(Object.keys(run.byTenant)).toEqual([alpha.tenantId]);
      expect(run.frozenTenants).toEqual([beta.tenantId]);
    });
  });

  /**
   * The route refuses a pinned caller before the sweep is reached, so the skip
   * inside it is checked on its own: it is what protects a tenant from a
   * platform-wide run, and nothing about the route exercises that path.
   */
  it("skips a frozen tenant even when the sweep is aimed at it", async () => {
    TenantSettings.set(alpha.tenantId, "maintenance_mode", "true");

    const run = await processHeldMessages(alpha.tenantId);

    expect(run.byTenant).toEqual({});
    expect(run.frozenTenants).toEqual([alpha.tenantId]);
    expect(run.messagesProcessed).toBe(0);
    expect(stillHeld(alpha.tenantId)).toBe(1);
  });
});

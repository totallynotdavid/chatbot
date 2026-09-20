/** Who an audit row names, and the readers that show it, including a row no user wrote. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
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
import {
  auditOn,
  getAuditTrail,
  logAction,
} from "../src/platform/audit/logger.ts";
import { SystemLogService } from "../src/domains/system/logs.ts";

const SOMEONE = { name: "someone", uid: 1000 };

type AuditRow = {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  actor: string;
  action: string;
};

function rowsFor(action: string): AuditRow[] {
  return db
    .prepare(
      "SELECT id, tenant_id, user_id, actor, action FROM audit_log WHERE action = ?",
    )
    .all(action) as AuditRow[];
}

function login(userId: string, tenantId: string | null): string {
  const token = generateSessionToken();
  createSession(token, userId, tenantId);
  return `session=${token}`;
}

describe("audit actors", () => {
  let tenant: TenantFixture;
  let action: string;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("actors");
    action = `test.${crypto.randomUUID()}`;
  });

  afterEach(() => {
    db.prepare("DELETE FROM audit_log WHERE action = ?").run(action);
    dropTenantFixture(tenant);
  });

  describe("logAction", () => {
    it("writes the acting user as user:<id>", () => {
      const { userId } = createMember(tenant);

      logAction({ userId, tenantId: tenant.tenantId }, action, "thing", "t1", {
        a: 1,
      });

      const [row, ...rest] = rowsFor(action);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        tenant_id: tenant.tenantId,
        user_id: userId,
        actor: `user:${userId}`,
      });
    });
  });

  describe("auditOn", () => {
    it("writes through the connection it is given, not the global one", () => {
      const other = new Database(":memory:");
      other.run(
        "CREATE TABLE audit_log (id TEXT, tenant_id TEXT, user_id TEXT, actor TEXT, action TEXT, resource_type TEXT, resource_id TEXT, metadata TEXT)",
      );

      auditOn(other).logCliAction(SOMEONE, null, action, "user", "u1", {});

      expect(other.prepare("SELECT actor FROM audit_log").all()).toEqual([
        { actor: "cli:someone" },
      ]);
      expect(rowsFor(action)).toEqual([]);
      other.close();
    });
  });

  describe("readers", () => {
    let cliRowId: string;

    beforeEach(() => {
      auditOn(db).logCliAction(
        SOMEONE,
        tenant.tenantId,
        action,
        "user",
        "u-target",
        { username: "maria" },
      );
      cliRowId = rowsFor(action)[0]!.id;
    });

    it("returns a row with no user from the trail", () => {
      const row = getAuditTrail(tenant.tenantId).find(
        (log) => log.id === cliRowId,
      );

      expect(row).toMatchObject({ user_id: null, actor: "cli:someone" });
    });

    it("shows the actor label where the system log would show a user name", () => {
      const entry = SystemLogService.getRecentLogs(tenant.tenantId).find(
        (log) => log.id === cliRowId,
      );

      expect(entry?.actor).toBe("cli:someone");
      expect(entry?.summary).toBe("user u-target");
    });

    it("still shows a user's name for a user's row", () => {
      const { userId } = createMember(tenant);
      logAction({ userId, tenantId: tenant.tenantId }, action, "thing");
      const id = rowsFor(action).find((row) => row.user_id === userId)!.id;

      const entry = SystemLogService.getRecentLogs(tenant.tenantId).find(
        (log) => log.id === id,
      );

      expect(entry?.actor).toBe(
        (
          db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as {
            username: string;
          }
        ).username,
      );
    });

    it("answers the audit page with the label as the name, beside a user's row", async () => {
      const { userId } = createMember(tenant);
      logAction({ userId, tenantId: tenant.tenantId }, action, "thing");

      const app = new Hono();
      app.use("/api/*", requireAuth);
      app.use("/api/admin/*", requireRole("admin"));
      app.route("/api/admin", adminRoutes);

      const response = await app.request("/api/admin/audit?limit=500", {
        headers: { Cookie: login(userId, tenant.tenantId) },
      });

      expect(response.status).toBe(200);
      const { logs } = (await response.json()) as {
        logs: Array<
          AuditRow & { user_name: string; user_username: string | null }
        >;
      };
      const mine = logs.filter((log) => log.action === action);

      const cli = mine.find((log) => log.id === cliRowId)!;
      expect(cli.user_id).toBeNull();
      expect(cli.actor).toBe("cli:someone");
      expect(cli.user_name).toBe("cli:someone");
      expect(cli.user_username).toBeNull();

      const person = mine.find((log) => log.user_id === userId)!;
      expect(person.user_name).toBe("Test User");
    });
  });
});

/**
 * What the audit trail says about the platform-wide operations sweeps.
 *
 * `/api/admin/process-held-messages` and `/api/admin/retry-eligibility` sit
 * behind `requireTenantScope`, which lets a platform operator through with no
 * tenant selected - and both then hand a null tenant to a processor that means
 * "every open tenant" by it. That cross-tenant sweep is the support case and
 * stays; what it left behind did not. One `logAction` with `tenantId: null` and
 * a set of aggregate counts recorded that somebody had mutated conversations
 * across the platform without recording which businesses, or what happened in
 * any of them - and it landed in none of those tenants' own trails either.
 *
 * Each tenant the run actually reaches now gets its own entry, with its own
 * counts. A run that reaches nobody still gets the one entry it would have had,
 * so an operator triggering a no-op is on the record too.
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
import { getAuditTrail } from "../src/platform/audit/logger.ts";
import { holdMessage } from "../src/conversation/held-messages.ts";
import { RetryEligibilityHandler } from "../src/domains/recovery/handlers/retry-eligibility-handler.ts";
import type { CheckEligibilityHandler } from "../src/domains/eligibility/handlers/check-eligibility-handler.ts";
import { Ok } from "../src/shared/result/index.ts";

const CUSTOMER = "51900333444";

type AuditRow = {
  tenant_id: string | null;
  action: string;
  metadata: string;
};

function buildApp() {
  const app = new Hono();
  app.use("/api/*", requireAuth);
  app.use("/api/admin/*", requireRole("admin"));
  app.route("/api/admin", adminRoutes);
  return app;
}

/** Every audit entry for one action, whichever tenant it belongs to. */
function entriesFor(action: string): AuditRow[] {
  return db
    .prepare(
      "SELECT tenant_id, action, metadata FROM audit_log WHERE action = ? ORDER BY created_at",
    )
    .all(action) as AuditRow[];
}

function login(userId: string, tenantId: string | null): string {
  const token = generateSessionToken();
  createSession(token, userId, tenantId);
  return `session=${token}`;
}

describe("auditing an operations sweep", () => {
  let app: ReturnType<typeof buildApp>;
  let alpha: TenantFixture;
  let beta: TenantFixture;
  let operator: string;

  beforeEach(() => {
    applySchema();
    app = buildApp();

    alpha = createTenantFixture("alpha-ops");
    beta = createTenantFixture("beta-ops");

    const operatorId = `u-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, name, is_platform_operator)
       VALUES (?, ?, 'x', 'admin', 'Operator', 1)`,
    ).run(operatorId, `op-${operatorId.slice(2, 12)}`);

    // No tenant pinned: this is the cross-tenant support session.
    operator = login(operatorId, null);
  });

  afterEach(() => {
    db.prepare("DELETE FROM audit_log WHERE tenant_id IS NULL").run();
    dropTenantFixture(alpha);
    dropTenantFixture(beta);
  });

  function post(path: string, cookie: string) {
    return app.request(path, { method: "POST", headers: { Cookie: cookie } });
  }

  describe("held messages, swept across every tenant at once", () => {
    beforeEach(() => {
      holdMessage(
        alpha.ref(CUSTOMER),
        "hola",
        `wamid-${crypto.randomUUID()}`,
        1,
      );
      holdMessage(
        beta.ref(CUSTOMER),
        "hola",
        `wamid-${crypto.randomUUID()}`,
        1,
      );
    });

    it("records one entry per tenant it touched, not one for the platform", async () => {
      const response = await post("/api/admin/process-held-messages", operator);
      expect(response.status).toBe(200);

      const entries = entriesFor("process_held_messages");

      expect(entries.map((e) => e.tenant_id).sort()).toEqual(
        [alpha.tenantId, beta.tenantId].sort(),
      );
      expect(entries.some((e) => e.tenant_id === null)).toBe(false);
    });

    it("puts the entry in the affected tenant's own trail", async () => {
      await post("/api/admin/process-held-messages", operator);

      const alphaTrail = getAuditTrail(alpha.tenantId).filter(
        (log) => log.action === "process_held_messages",
      );

      expect(alphaTrail).toHaveLength(1);
      // ...and only their own: the other business's sweep is not their business.
      expect(alphaTrail[0]!.tenant_id).toBe(alpha.tenantId);
    });

    it("says the entry came from a cross-tenant sweep", async () => {
      await post("/api/admin/process-held-messages", operator);

      for (const entry of entriesFor("process_held_messages")) {
        expect(JSON.parse(entry.metadata)).toMatchObject({
          sweptAcrossTenants: true,
        });
      }
    });

    it("keeps a pinned admin's run inside their own tenant", async () => {
      const admin = createMember(alpha, "admin");

      const response = await post(
        "/api/admin/process-held-messages",
        login(admin.userId, alpha.tenantId),
      );
      expect(response.status).toBe(200);

      const entries = entriesFor("process_held_messages");

      expect(entries).toHaveLength(1);
      expect(entries[0]!.tenant_id).toBe(alpha.tenantId);
      expect(JSON.parse(entries[0]!.metadata)).toMatchObject({
        sweptAcrossTenants: false,
      });
      // Beta's held message is still held: a pinned caller swept only alpha.
      expect(
        db
          .prepare(
            "SELECT COUNT(*) as c FROM held_messages WHERE tenant_id = ? AND processed_at IS NULL",
          )
          .get(beta.tenantId),
      ).toEqual({ c: 1 });
    });
  });

  /**
   * The counts the entries are written from. Splitting them per tenant is what
   * makes an entry per tenant possible at all, so it is checked on the handler
   * as well as through the route.
   */
  it("splits the retry sweep's counts by tenant", async () => {
    for (const fixture of [alpha, beta]) {
      db.prepare(
        `INSERT INTO conversations
           (tenant_id, channel_account_id, phone_number, context_data)
         VALUES (?, ?, ?, ?)`,
      ).run(
        fixture.tenantId,
        fixture.channelAccountId,
        CUSTOMER,
        JSON.stringify({
          phase: { phase: "waiting_for_recovery", dni: "12345678" },
          metadata: { createdAt: Date.now(), lastActivityAt: Date.now() },
        }),
      );
    }

    // The provider is still down, so every conversation stays where it is and
    // nothing is sent; only the bookkeeping is under test.
    const stillDown = {
      execute: async () =>
        Ok({ type: "eligibility_result", status: "system_outage" }),
    } as unknown as CheckEligibilityHandler;

    const result = await new RetryEligibilityHandler(stillDown).execute(null);

    if (!result.ok) throw new Error("Expected success result");

    expect(result.value.stillFailingCount).toBe(2);
    expect(result.value.byTenant).toEqual({
      [alpha.tenantId]: {
        recoveredCount: 0,
        stillFailingCount: 1,
        errors: 0,
      },
      [beta.tenantId]: {
        recoveredCount: 0,
        stillFailingCount: 1,
        errors: 0,
      },
    });
  });

  it("still records a sweep that reached no tenant", async () => {
    const response = await post("/api/admin/retry-eligibility", operator);
    expect(response.status).toBe(200);

    const entries = entriesFor("retry_eligibility");

    expect(entries).toHaveLength(1);
    expect(entries[0]!.tenant_id).toBeNull();
    expect(JSON.parse(entries[0]!.metadata)).toMatchObject({
      tenantsAffected: 0,
      recoveredCount: 0,
    });
  });
});

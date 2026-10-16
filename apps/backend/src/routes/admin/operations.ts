import { Hono } from "hono";
import { isOk } from "../../shared/result/index.ts";
import { retryEligibilityHandler } from "../../bootstrap/index.ts";
import { countWaitingForRecovery } from "../../domains/recovery/store/index.ts";
import { logAction } from "../../platform/audit/logger.ts";
import { requireTenantScope } from "../../middleware/auth.ts";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("admin-operations");

const operations = new Hono();

// These touch conversation state, so they run inside the caller's tenant.
// An unpinned platform operator sweeps every open tenant, which is the support
// case.
operations.use("/*", requireTenantScope);

type SweepStats = Record<string, number>;

/**
 * Audits an operation that may have run across several tenants. Each tenant
 * the run reached gets its own entry, because one aggregate entry would not
 * say which businesses were mutated. A run that reached nobody gets one entry
 * under the caller's scope, so a run that did nothing stays on record.
 */
function logSweep(
  userId: string,
  callerTenantId: string | null,
  action: string,
  totals: SweepStats,
  byTenant: Record<string, SweepStats>,
): void {
  const affected = Object.entries(byTenant);

  if (affected.length === 0) {
    logAction({ userId, tenantId: callerTenantId }, action, "system", null, {
      ...totals,
      tenantsAffected: 0,
    });
    return;
  }

  for (const [tenantId, stats] of affected) {
    logAction({ userId, tenantId }, action, "system", null, {
      ...stats,
      // A tenant-scoped run is indistinguishable from a platform-wide sweep
      // once the entries are split up, so each one says which it came from.
      sweptAcrossTenants: callerTenantId === null,
    });
  }
}

operations.get("/outage-status", (c) => {
  const waitingCount = countWaitingForRecovery(c.get("scope").tenantId);
  return c.json({ waitingCount });
});

// Retry eligibility for waiting users
operations.post("/retry-eligibility", async (c) => {
  const user = c.get("user");
  const scope = c.get("scope");

  const result = await retryEligibilityHandler.execute(scope.tenantId);

  if (isOk(result)) {
    const { byTenant, ...stats } = result.value;

    logSweep(user.id, scope.tenantId, "retry_eligibility", stats, byTenant);

    return c.json({
      success: true,
      message: `Recuperados ${stats.recoveredCount}, fallando ${stats.stillFailingCount}, errores ${stats.errors}`,
      stats,
    });
  }

  logger.error({ error: result.error }, "Retry eligibility failed");
  return c.json({ error: result.error.message }, 500);
});

export default operations;

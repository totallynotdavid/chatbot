import { Hono } from "hono";
import { isOk } from "../../shared/result/index.ts";
import { retryEligibilityHandler } from "../../bootstrap/index.ts";
import { countWaitingForRecovery } from "../../domains/recovery/store/index.ts";
import {
  processHeldMessages,
  countHeldMessages,
} from "../../conversation/index.ts";
import { isMaintenanceMode } from "../../domains/settings/system.ts";
import { logAction } from "../../platform/audit/logger.ts";
import { requireTenantScope } from "../../middleware/auth.ts";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("admin-operations");

const operations = new Hono();

// These touch conversation state, so they run inside the caller's tenant.
// An unpinned platform operator sweeps every open tenant, which is the support
// case.
operations.use("/*", requireTenantScope);

/** Per-tenant counts, as both processors below report them. */
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

operations.get("/held-messages-status", (c) => {
  const count = countHeldMessages(c.get("scope").tenantId);
  return c.json({ pendingCount: count });
});

// Process held messages from maintenance mode
operations.post("/process-held-messages", async (c) => {
  const user = c.get("user");
  const scope = c.get("scope");

  // Maintenance mode holds customer messages instead of answering them, and
  // `processHeldMessages` answers customers. The dashboard hides the button
  // (settings/+page.svelte), but only this check makes the API refuse.
  // `isMaintenanceMode` checks two scopes. A platform-wide freeze refuses every
  // caller, and a tenant's own freeze refuses a caller pinned to that tenant.
  if (isMaintenanceMode(scope.tenantId ?? undefined)) {
    return c.json(
      {
        success: false,
        error: "maintenance_mode",
        message:
          "Modo mantenimiento activo: los mensajes siguen retenidos hasta desactivarlo",
      },
      409,
    );
  }

  const pendingCount = countHeldMessages(scope.tenantId);

  if (pendingCount === 0) {
    return c.json({
      success: true,
      message: "No held messages to process",
      stats: {
        usersProcessed: 0,
        messagesProcessed: 0,
        errors: 0,
        stillAnswering: 0,
      },
    });
  }

  logger.info(
    { username: user.username, tenantId: scope.tenantId, pendingCount },
    "Admin triggered held messages processing",
  );

  // An unpinned platform operator reaches this when only some businesses are
  // frozen. The sweep skips those (see conversation/process-held.ts), so they
  // do not hold up recovery for everyone else.
  const { byTenant, frozenTenants, ...stats } = await processHeldMessages(
    scope.tenantId,
  );

  logSweep(user.id, scope.tenantId, "process_held_messages", stats, byTenant);

  if (frozenTenants.length > 0) {
    logger.info(
      { username: user.username, frozenTenants },
      "Left held messages untouched for tenants in their own maintenance mode",
    );
  }

  const userWord = stats.usersProcessed === 1 ? "usuario" : "usuarios";
  const messageWord = stats.messagesProcessed === 1 ? "mensaje" : "mensajes";

  const inFlightWords =
    stats.stillAnswering === 1 ? "conversación sigue" : "conversaciones siguen";
  const stillAnswering =
    stats.stillAnswering > 0
      ? `; ${stats.stillAnswering} ${inFlightWords} en curso`
      : "";

  return c.json({
    success: true,
    message: `Procesados ${stats.messagesProcessed} ${messageWord} de ${stats.usersProcessed} ${userWord}${stillAnswering}`,
    stats,
    // Named so an operator sweeping the platform can see that a business was
    // deliberately skipped rather than silently missed.
    tenantsInMaintenance: frozenTenants.length,
  });
});

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

import { Hono } from "hono";
import { getAll, tenantPredicate } from "../../db/query.ts";
import { logAction, getAuditTrail } from "../../platform/audit/logger.ts";
import {
  SystemSettings,
  TenantSettings,
  isInternalTenantSettingKey,
  isMaintenanceMode,
  isPlatformSettingKey,
  TENANT_VISIBLE_PLATFORM_KEYS,
} from "../../domains/settings/system.ts";
import { getRecentLLMCalls } from "../../intelligence/tracker.ts";
import { requireTenantScope } from "../../middleware/auth.ts";

const system = new Hono();

system.use("/*", requireTenantScope);

/**
 * LLM call traces for the caller's tenant. (The previous implementation read a
 * table named `llm_errors` that the schema has never defined; the traces live
 * in `llm_calls`, and the error rows are the ones with status = 'error'.)
 */
system.get("/llm-errors", (c) => {
  const scope = c.get("scope");
  const phoneFilter = c.req.query("phone");
  const operationFilter = c.req.query("operation");
  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 100;

  const conditions = ["status = 'error'"];
  const params: (string | number)[] = [];

  conditions.push(tenantPredicate(scope.tenantId));
  if (scope.tenantId) params.push(scope.tenantId);

  if (phoneFilter) {
    conditions.push("phone_number = ?");
    params.push(phoneFilter);
  }
  if (operationFilter) {
    conditions.push("operation = ?");
    params.push(operationFilter);
  }

  params.push(limit);

  const errors = getAll<{
    id: string;
    phone_number: string;
    operation: string;
    error_type: string | null;
    error_message: string | null;
    conversation_phase: string | null;
    context_metadata: string | null;
    created_at: string;
  }>(
    `SELECT id, phone_number, operation, error_type, error_message,
            conversation_phase, context_metadata, created_at
     FROM llm_calls
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC LIMIT ?`,
    params,
  );

  return c.json({
    errors: errors.map((e) => ({
      ...e,
      metadata: e.context_metadata ? JSON.parse(e.context_metadata) : null,
    })),
  });
});

system.get("/llm-calls", (c) => {
  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 50;
  return c.json({ calls: getRecentLLMCalls(c.get("scope").tenantId, limit) });
});

system.get("/audit", (c) => {
  const scope = c.get("scope");
  const userIdFilter = c.req.query("user_id");
  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 100;

  const logs = getAuditTrail(scope.tenantId, userIdFilter, limit);

  const userIds = [
    ...new Set(logs.flatMap((l) => (l.user_id === null ? [] : [l.user_id]))),
  ];
  const dbUsers = userIds.length
    ? getAll<{ id: string; username: string; name: string }>(
        `SELECT id, username, name FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
        userIds,
      )
    : [];

  const userMap = new Map(dbUsers.map((u) => [u.id, u]));

  const logsWithNames = logs.map((log) => {
    if (log.user_id === null) {
      return { ...log, user_name: log.actor, user_username: null };
    }

    return {
      ...log,
      user_name: userMap.get(log.user_id)?.name || "Usuario eliminado",
      user_username: userMap.get(log.user_id)?.username || log.user_id,
    };
  });

  return c.json({ logs: logsWithNames });
});

/**
 * Settings split by ownership: a tenant admin reads and writes their own
 * tenant's settings, and additionally sees the handful of platform values their
 * dashboard renders - the maintenance freeze and the shared Calidda kill
 * switches, TENANT_VISIBLE_PLATFORM_KEYS - read-only, as `_platform_<key>`. An
 * unpinned platform operator reads and writes the platform settings themselves,
 * all of them, under their own names.
 */
system.get("/settings", (c) => {
  const scope = c.get("scope");
  const platform = SystemSettings.getAll();

  if (!scope.tenantId) {
    return c.json({ ...platform, _scope: "platform" });
  }

  // The dashboard posts back whatever this returns, so the internal rows are
  // dropped here as well as refused on the write: left in, every save would
  // resubmit the round-robin cursor and be told its own read was rejected.
  const tenant = Object.fromEntries(
    Object.entries(TenantSettings.getAll(scope.tenantId)).filter(
      ([key]) => !isInternalTenantSettingKey(key),
    ),
  );

  // The platform side is narrowed the same way, and for the same reason the
  // tenant side is: only the values this tenant's own dashboard renders leave
  // the platform scope. Spreading all of SystemSettings handed every tenant
  // admin VendeYa's deployment configuration - `platform_ops_channel_account_id`
  // among it - which no UI asks for and none of them are entitled to.
  //
  // And none of them arrives under its own name. Every key without a leading
  // underscore here is one the dashboard posts straight back on the next save,
  // and a platform key posted back by a tenant admin is refused - so returning
  // `force_fnb_down` and `force_gaso_down` raw made every save of this page
  // answer `rejected: ["force_fnb_down", "force_gaso_down"]` for a write nobody
  // attempted, drowning the one signal `rejected` exists to give. Keys starting
  // with "_" are skipped by POST /settings, so a platform value reported as
  // `_platform_<key>` is information the page can render and cannot round-trip.
  //
  // `maintenance_mode` shows why this matters beyond noise: it is the one key
  // that exists at both levels, and the platform's value used to be returned in
  // the writable field. With a platform-wide freeze on, every tenant's
  // dashboard loaded `maintenance_mode: "true"`, and the next save of any
  // unrelated setting wrote it into the tenant's own row - leaving those tenants
  // frozen, by a setting nobody chose, after the platform freeze lifted. So
  // `maintenance_mode` is left to arrive through the tenant spread like any
  // other tenant setting, present only when this business has stored one.
  const visiblePlatform = Object.fromEntries(
    TENANT_VISIBLE_PLATFORM_KEYS.map((key) => [
      `_platform_${key}`,
      platform[key] ?? "false",
    ]),
  );

  return c.json({
    ...tenant,
    ...visiblePlatform,
    // What actually governs the bot, which is what the dashboard must render:
    // a tenant whose own toggle is off is still frozen by a platform freeze.
    _effective_maintenance_mode: String(isMaintenanceMode(scope.tenantId)),
    _scope: "tenant",
  });
});

system.post("/settings", async (c) => {
  const user = c.get("user");
  const scope = c.get("scope");
  const settings = await c.req.json();

  const updates: Record<string, string> = {};

  if (!scope.tenantId) {
    // Platform operator, no tenant selected: writes land on platform config.
    for (const [key, value] of Object.entries(settings)) {
      if (key.startsWith("_")) continue;
      SystemSettings.set(key, String(value));
      updates[key] = String(value);
    }

    logAction(
      { userId: user.id, tenantId: null },
      "update_platform_settings",
      "system",
      null,
      updates,
    );

    return c.json({ success: true, updates, scope: "platform" });
  }

  // Tenant-scoped writers cannot reach platform switches. `maintenance_mode` is
  // the exception both sides own: a business may freeze itself, and that is
  // stored per tenant.
  //
  // Nor can they reach the keys the application owns inside their own tenant.
  // `tenant_settings` is one flat table, so without this a tenant admin writes
  // straight into another module's working state - and that state is read back
  // unvalidated, so the damage is silent (see INTERNAL_TENANT_SETTING_KEYS).
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("_")) continue;
    if (isPlatformSettingKey(key) && key !== "maintenance_mode") {
      rejected.push(key);
      continue;
    }
    if (isInternalTenantSettingKey(key)) {
      rejected.push(key);
      continue;
    }
    TenantSettings.set(scope.tenantId, key, String(value));
    updates[key] = String(value);
  }

  logAction(
    { userId: user.id, tenantId: scope.tenantId },
    "update_settings",
    "system",
    null,
    updates,
  );

  return c.json({ success: true, updates, rejected, scope: "tenant" });
});

export default system;

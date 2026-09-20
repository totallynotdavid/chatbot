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

system.get("/settings", (c) => {
  const scope = c.get("scope");
  const platform = SystemSettings.getAll();

  if (!scope.tenantId) {
    // A platform operator with no tenant selected reads every platform setting
    // under its own name.
    return c.json({ ...platform, _scope: "platform" });
  }

  // The dashboard posts back whatever this returns. Internal rows are dropped
  // here as well as refused on the write, so a save never resubmits the
  // round-robin cursor and gets its own read back in `rejected`.
  const tenant = Object.fromEntries(
    Object.entries(TenantSettings.getAll(scope.tenantId)).filter(
      ([key]) => !isInternalTenantSettingKey(key),
    ),
  );

  // Only the platform values in TENANT_VISIBLE_PLATFORM_KEYS leave the platform
  // scope. The rest, such as `platform_ops_channel_account_id`, is deployment
  // configuration that a tenant admin must not read.
  const visiblePlatform = Object.fromEntries(
    TENANT_VISIBLE_PLATFORM_KEYS.map((key) => [
      // POST /settings skips keys that start with "_". The dashboard can render
      // a platform value under this name but cannot post it back. An unprefixed
      // platform key would be posted back on the next save and be refused into
      // `rejected`.
      `_platform_${key}`,
      platform[key] ?? "false",
    ]),
  );

  return c.json({
    // `maintenance_mode` exists at both levels. The plain key comes only from
    // the tenant's own row, and the platform value appears only as
    // `_platform_maintenance_mode`. Returning the platform value under the
    // plain key would make the next save of any setting write it into the
    // tenant's row.
    ...tenant,
    ...visiblePlatform,
    // A platform freeze applies to every tenant, even one whose own toggle is
    // off. The dashboard renders this effective value.
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

  const rejected: string[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("_")) continue;
    // Tenant-scoped writers cannot write platform keys. `maintenance_mode` is
    // the exception because a business may freeze itself, and that value is
    // stored per tenant.
    if (isPlatformSettingKey(key) && key !== "maintenance_mode") {
      rejected.push(key);
      continue;
    }
    // `tenant_settings` is one flat table, and the application keeps its own
    // working state in it. A hand-written value changes where that state
    // resumes (see INTERNAL_TENANT_SETTING_KEYS).
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

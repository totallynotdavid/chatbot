import { db } from "../../db/index.ts";
import { getAll, getOne } from "../../db/query.ts";

type SettingRow = {
  value: string;
};

/**
 * Keys that stay platform-wide because they describe the deployment rather than
 * any one business: the shared Calidda provider kill switches, a platform-wide
 * maintenance freeze, and the channel account VendeYa's own operations alerts
 * are sent from. Only platform operators may write these.
 */
export const PLATFORM_SETTING_KEYS = [
  "maintenance_mode",
  "force_fnb_down",
  "force_gaso_down",
  "platform_ops_channel_account_id",
] as const;

export function isPlatformSettingKey(key: string): boolean {
  return (PLATFORM_SETTING_KEYS as readonly string[]).includes(key);
}

/**
 * The platform values a tenant admin is shown, read-only, because their own
 * dashboard has something to say about them: a platform-wide freeze holds this
 * tenant's messages whatever the tenant's own setting says, and the two Calidda
 * kill switches are rendered as disabled toggles so the state of a shared
 * integration is visible to the business it is affecting. They are reported as
 * `_platform_<key>`, never under their own names, so a tenant's save cannot post
 * them back (routes/admin/system.ts).
 *
 * An allowlist rather than "everything on the platform": VendeYa's own
 * deployment configuration is not a tenant's business, and
 * `platform_ops_channel_account_id` - the internal channel account its
 * operations alerts are sent from - has no place in a customer's settings
 * response. Anything added to PLATFORM_SETTING_KEYS is therefore private to
 * platform operators until it is named here too.
 */
export const TENANT_VISIBLE_PLATFORM_KEYS = [
  "maintenance_mode",
  "force_fnb_down",
  "force_gaso_down",
] as const;

/**
 * Tenant keys the application writes and reads back as its own working state,
 * rather than configuration a person sets. `tenant_settings` is a bare key/value
 * table, so these sit next to the operator-owned rows with nothing marking them
 * apart - and a hand-written value does not fail loudly, it corrupts the logic
 * that stores it: `last_agent_index` is the round-robin cursor in
 * domains/conversations/assignment.ts, and a non-numeric one makes every
 * subsequent index NaN, which stops the tenant assigning any agent at all.
 *
 * They are therefore refused on the settings write path and left out of what it
 * reads back, the same way platform keys are refused to a tenant admin. Nothing
 * legitimate writes them through HTTP; the modules that own them keep using
 * `TenantSettings.set` directly.
 */
export const INTERNAL_TENANT_SETTING_KEYS = ["last_agent_index"] as const;

export function isInternalTenantSettingKey(key: string): boolean {
  return (INTERNAL_TENANT_SETTING_KEYS as readonly string[]).includes(key);
}

export const SystemSettings = {
  get(key: string): string | null {
    const row = getOne<SettingRow>(
      "SELECT value FROM system_settings WHERE key = ?",
      [key],
    );
    return row?.value ?? null;
  },

  getAll(): Record<string, string> {
    const rows = getAll<{ key: string; value: string }>(
      "SELECT key, value FROM system_settings",
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },

  set(key: string, value: string): void {
    db.prepare(
      "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)",
    ).run(key, value, Date.now());
  },
};

export const TenantSettings = {
  get(tenantId: string, key: string): string | null {
    const row = getOne<SettingRow>(
      "SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = ?",
      [tenantId, key],
    );
    return row?.value ?? null;
  },

  getAll(tenantId: string): Record<string, string> {
    const rows = getAll<{ key: string; value: string }>(
      "SELECT key, value FROM tenant_settings WHERE tenant_id = ?",
      [tenantId],
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },

  set(tenantId: string, key: string, value: string): void {
    db.prepare(
      `INSERT INTO tenant_settings (tenant_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(tenantId, key, value, Date.now());
  },
};

/**
 * Maintenance holds messages instead of processing them. Either the platform or
 * the individual business can be in maintenance; both hold.
 */
export function isMaintenanceMode(tenantId?: string): boolean {
  if (SystemSettings.get("maintenance_mode") === "true") return true;
  if (!tenantId) return false;
  return TenantSettings.get(tenantId, "maintenance_mode") === "true";
}

/**
 * Calidda's FNB and GASO endpoints are shared platform integrations, not
 * per-tenant ones, so forcing them down is a platform-level switch.
 */
export function isProviderForcedDown(provider: "fnb" | "gaso"): boolean {
  const key = provider === "fnb" ? "force_fnb_down" : "force_gaso_down";
  return SystemSettings.get(key) === "true";
}

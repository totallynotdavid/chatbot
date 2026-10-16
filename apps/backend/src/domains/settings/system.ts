import { db } from "../../db/index.ts";
import { getAll, getOne } from "../../db/query.ts";

type SettingRow = {
  value: string;
};

/**
 * Keys that describe the deployment rather than any one business. A platform
 * operator with no tenant selected writes them. A tenant-scoped writer is
 * refused.
 */
export const PLATFORM_SETTING_KEYS = [
  "force_fnb_down",
  "force_gaso_down",
  "platform_ops_channel_account_id",
] as const;

export function isPlatformSettingKey(key: string): boolean {
  return (PLATFORM_SETTING_KEYS as readonly string[]).includes(key);
}

/**
 * The platform values a tenant admin is shown read-only, reported as
 * `_platform_<key>` so a tenant's save cannot post them back. This is an
 * allowlist, so a key added to PLATFORM_SETTING_KEYS stays hidden from
 * tenant-scoped callers until it is named here too.
 */
export const TENANT_VISIBLE_PLATFORM_KEYS = [
  // Shared Calidda integrations, shown as disabled toggles on the dashboard.
  "force_fnb_down",
  "force_gaso_down",
] as const;

/**
 * Tenant keys the application writes as its own working state, such as the
 * round-robin cursor `last_agent_index`. A value written by hand changes where
 * the rotation resumes, so the settings route refuses these keys and leaves
 * them out of what it reads back.
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
 * Calidda's FNB and GASO endpoints are shared platform integrations, not
 * per-tenant ones, so forcing them down is a platform-level switch.
 */
export function isProviderForcedDown(provider: "fnb" | "gaso"): boolean {
  const key = provider === "fnb" ? "force_fnb_down" : "force_gaso_down";
  return SystemSettings.get(key) === "true";
}

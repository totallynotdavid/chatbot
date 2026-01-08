import { getOne } from "../../db/query.ts";

type SettingRow = {
  value: string;
};

function getSetting(key: string): string | null {
  const row = getOne<SettingRow>(
    "SELECT value FROM system_settings WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export function isMaintenanceMode(): boolean {
  return getSetting("maintenance_mode") === "true";
}

export function isProviderForcedDown(provider: "fnb" | "gaso"): boolean {
  const key = provider === "fnb" ? "force_fnb_down" : "force_gaso_down";
  return getSetting(key) === "true";
}

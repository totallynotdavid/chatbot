import type { Database } from "bun:sqlite";
import { periodId } from "../../domains/catalog/periods.ts";

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function getCurrentPeriod(tenantId: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const yearMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
  const name = `${MONTH_NAMES[month]} ${year}`;

  return { id: periodId(tenantId, yearMonth), name, yearMonth };
}

/**
 * Make sure the tenant has this month's period, because that is the one the
 * catalog seed writes its bundles into.
 *
 * Skipping the insert whenever the tenant had *any* period looked equivalent
 * and was not: the month after onboarding - or a tenant migrated in with an
 * older period - has periods but not this one, and the bundle seed's insert
 * then failed its foreign key and took the whole startup down with it.
 *
 * A tenant that already runs a catalog keeps running it: the new month is added
 * as a draft for someone to publish, rather than quietly becoming a second
 * active period alongside the live one.
 */
export async function seedPeriods(db: Database, tenantId: string) {
  const period = getCurrentPeriod(tenantId);

  const existing = db
    .prepare(
      "SELECT count(*) as count FROM catalog_periods WHERE tenant_id = ? AND year_month = ?",
    )
    .get(tenantId, period.yearMonth) as { count: number };

  if (existing.count > 0) {
    return;
  }

  const anyPeriod = db
    .prepare(
      "SELECT count(*) as count FROM catalog_periods WHERE tenant_id = ?",
    )
    .get(tenantId) as { count: number };

  const status = anyPeriod.count > 0 ? "draft" : "active";

  db.prepare(
    `INSERT INTO catalog_periods (id, tenant_id, name, year_month, status, created_by)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(period.id, tenantId, period.name, period.yearMonth, status);
}

/** The id of the period for the month we are in, seeded or not. */
export function currentPeriodId(tenantId: string): string {
  return getCurrentPeriod(tenantId).id;
}

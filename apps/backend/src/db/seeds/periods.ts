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
 * Ensures the tenant has a period for the current month, because the catalog
 * seed inserts its bundles into that period.
 */
export async function seedPeriods(db: Database, tenantId: string) {
  const period = getCurrentPeriod(tenantId);

  // Check for this month's period, not for any period. A tenant created in an
  // earlier month has periods but not this one, and the bundle insert would
  // then fail its foreign key.
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

  // A tenant that already has a period keeps its live catalog. The new month
  // is a draft to publish, not a second active period.
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

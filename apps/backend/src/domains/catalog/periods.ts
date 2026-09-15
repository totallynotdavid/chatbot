import { db } from "../../db/index.ts";
import { getOne, getAll, tenantPredicate } from "../../db/query.ts";
import { tenantScopedId } from "./ids.ts";
import type { CatalogPeriod, PeriodStatus } from "@totem/types";

type CreatePeriodData = {
  tenantId: string;
  name: string;
  year_month: string;
  created_by: string | null;
};

/**
 * Period ids embed the tenant so two businesses can both run a "2026-09"
 * period. Uniqueness is enforced by the (tenant_id, year_month) constraint;
 * the id is just a readable handle.
 */
export function periodId(tenantId: string, yearMonth: string): string {
  return tenantScopedId(tenantId, `period-${yearMonth}`);
}

/**
 * `tenantId` null reads across tenants and is only reachable by a platform
 * operator; every tenant-scoped caller passes a concrete id.
 */
export const PeriodService = {
  getAll: (tenantId: string | null): CatalogPeriod[] =>
    getAll<CatalogPeriod>(
      `SELECT * FROM catalog_periods
       WHERE ${tenantPredicate(tenantId)}
       ORDER BY year_month DESC`,
      tenantId ? [tenantId] : [],
    ),

  getById: (tenantId: string | null, id: string): CatalogPeriod | null =>
    getOne<CatalogPeriod>(
      `SELECT * FROM catalog_periods
       WHERE id = ? AND ${tenantPredicate(tenantId)}`,
      tenantId ? [id, tenantId] : [id],
    ) ?? null,

  getActive: (tenantId: string): CatalogPeriod | null =>
    getOne<CatalogPeriod>(
      "SELECT * FROM catalog_periods WHERE tenant_id = ? AND status = 'active' LIMIT 1",
      [tenantId],
    ) ?? null,

  getByYearMonth: (tenantId: string, yearMonth: string): CatalogPeriod | null =>
    getOne<CatalogPeriod>(
      "SELECT * FROM catalog_periods WHERE tenant_id = ? AND year_month = ?",
      [tenantId, yearMonth],
    ) ?? null,

  create: (data: CreatePeriodData): CatalogPeriod => {
    const id = periodId(data.tenantId, data.year_month);

    db.prepare(
      `INSERT INTO catalog_periods (id, tenant_id, name, year_month, status, created_by)
       VALUES (?, ?, ?, ?, 'draft', ?)`,
    ).run(id, data.tenantId, data.name, data.year_month, data.created_by);

    return PeriodService.getById(data.tenantId, id)!;
  },

  updateStatus: (
    tenantId: string,
    id: string,
    status: PeriodStatus,
  ): CatalogPeriod => {
    const now = Date.now();

    if (status === "active") {
      // Deactivate any currently active period *for this tenant only*
      db.prepare(
        "UPDATE catalog_periods SET status = 'archived' WHERE tenant_id = ? AND status = 'active'",
      ).run(tenantId);

      // Set this one active with published timestamp
      db.prepare(
        "UPDATE catalog_periods SET status = 'active', published_at = ? WHERE id = ? AND tenant_id = ?",
      ).run(now, id, tenantId);
    } else {
      db.prepare(
        "UPDATE catalog_periods SET status = ? WHERE id = ? AND tenant_id = ?",
      ).run(status, id, tenantId);
    }

    return PeriodService.getById(tenantId, id)!;
  },

  delete: (
    tenantId: string,
    id: string,
  ): { success: boolean; message?: string } => {
    // Only allow deleting draft periods with no products
    const period = PeriodService.getById(tenantId, id);
    if (!period) {
      return { success: false, message: "Período no encontrado" };
    }

    if (period.status !== "draft") {
      return {
        success: false,
        message: "Solo se pueden eliminar períodos en borrador",
      };
    }

    // Check for bundles
    const bundleCount = getOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM catalog_bundles WHERE tenant_id = ? AND period_id = ?",
      [tenantId, id],
    )!;

    if (bundleCount.count > 0) {
      return {
        success: false,
        message: "No se puede eliminar un período con productos",
      };
    }

    db.prepare(
      "DELETE FROM catalog_periods WHERE id = ? AND tenant_id = ?",
    ).run(id, tenantId);
    return { success: true };
  },
};

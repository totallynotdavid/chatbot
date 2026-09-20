import { db } from "../../db/index.ts";
import { getOne, getAll, tenantPredicate } from "../../db/query.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import type { Bundle } from "@totem/types";
import { imageStorage } from "../../adapters/storage/images.ts";
import { AssetService } from "../assets/index.ts";

/**
 * Drop a bundle's claim on its image. The asset row is this tenant's own
 * record and always goes. The image file goes only with its last reference.
 * `bundleId` still holds its old `image_id` when this runs, so the count of
 * references excludes it.
 */
async function releaseImage(
  tenantId: string,
  bundleId: string,
  imageId: string,
): Promise<void> {
  AssetService.deleteByStorageKey(tenantId, imageStorage.storageKey(imageId));

  // The bytes are shared. Tenants seeded from the base catalog get the same
  // `image_id`s, so the seeded bundles of two businesses name the same image
  // even though their bundle ids are tenant-scoped. Deleting the file while
  // another row still points at it would blank that bundle for the other
  // tenant, in the dashboard and on WhatsApp.
  const others = getOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM catalog_bundles
     WHERE image_id = ? AND NOT (id = ? AND tenant_id = ?)`,
    [imageId, bundleId, tenantId],
  );

  if ((others?.count ?? 0) > 0) return;

  await imageStorage.delete(imageId);
}

type BundleFilters = {
  periodId?: string;
  maxPrice?: number;
  category?: string;
  strictPriceLimit?: boolean;
  offset?: number;
  query?: string;
  segment?: "gaso" | "fnb";
};

/**
 * Every read takes the tenant whose catalog is being read. `getByPeriod` and
 * `getById` also accept null for the cross-tenant read, which an unpinned
 * platform operator reaches through the catalog routes.
 */
export const BundleService = {
  /** Get all bundles for a period (dashboard) */
  getByPeriod: (
    tenantId: string | null,
    periodId: string,
    segment?: "gaso" | "fnb",
  ): Bundle[] => {
    const params: SQLQueryBindings[] = [periodId];
    let sql = "SELECT * FROM catalog_bundles WHERE period_id = ?";

    sql += ` AND ${tenantPredicate(tenantId)}`;
    if (tenantId) params.push(tenantId);
    if (segment) {
      sql += " AND segment = ?";
      params.push(segment);
    }

    sql += " ORDER BY primary_category, price";
    return getAll<Bundle>(sql, params);
  },

  /** Get available bundles for bot (active period, filters) */
  getAvailable: (tenantId: string, filters: BundleFilters = {}): Bundle[] => {
    let query = `
      SELECT b.* FROM catalog_bundles b
      JOIN catalog_periods p ON b.period_id = p.id AND p.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND p.status = 'active'
        AND b.is_active = 1
        AND b.stock_status != 'out_of_stock'
    `;
    const params: SQLQueryBindings[] = [tenantId];

    if (filters.segment) {
      query += " AND b.segment = ?";
      params.push(filters.segment);
    }

    if (filters.strictPriceLimit && filters.maxPrice !== undefined) {
      query += " AND b.price <= ?";
      params.push(filters.maxPrice);
    }

    if (filters.category) {
      // Match primary_category OR any category in categories_json
      query += " AND (b.primary_category = ? OR b.categories_json LIKE ?)";
      params.push(filters.category, `%"${filters.category}"%`);
    }

    if (filters.query) {
      query += " AND b.name LIKE ?";
      params.push(`%${filters.query}%`);
    }

    query += " ORDER BY b.price ASC";
    query += " LIMIT 3";

    if (filters.offset) {
      query += " OFFSET ?";
      params.push(filters.offset);
    }

    const rows = getAll<Bundle>(query, params);
    return rows;
  },

  getById: (tenantId: string | null, id: string): Bundle | null =>
    getOne<Bundle>(
      `SELECT * FROM catalog_bundles WHERE id = ? AND ${tenantPredicate(tenantId)}`,
      tenantId ? [id, tenantId] : [id],
    ) ?? null,

  create: (data: {
    id: string;
    tenantId: string;
    period_id: string;
    segment: "gaso" | "fnb";
    name: string;
    price: number;
    primary_category: string;
    categories_json: string;
    image_id: string;
    composition_json: string;
    installments_json: string;
    notes?: string;
    created_by: string | null;
  }): Bundle => {
    db.prepare(`
      INSERT INTO catalog_bundles (id, tenant_id, period_id, segment, name, price, primary_category, categories_json, image_id, composition_json, installments_json, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      data.tenantId,
      data.period_id,
      data.segment,
      data.name,
      data.price,
      data.primary_category,
      data.categories_json,
      data.image_id,
      data.composition_json,
      data.installments_json,
      data.notes || "01 año de garantía, delivery gratuito, cero cuota inicial",
      data.created_by,
    );
    return BundleService.getById(data.tenantId, data.id)!;
  },

  /**
   * Editable bundle fields, one `if` per column. Unknown keys are ignored, not
   * rejected. The type is the contract and this list is the enforcement.
   */
  update: (
    tenantId: string,
    id: string,
    updates: Partial<
      Pick<Bundle, "name" | "price" | "is_active" | "stock_status" | "notes">
    >,
  ): Bundle | null => {
    const data = updates ?? {};
    // Callers hand this raw request bodies, so `tenant_id` must not reach the
    // SET clause. The WHERE still matches on the row's current tenant, so a
    // body that carried it would hand the row to another business.
    const fields: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (data.name !== undefined) {
      fields.push("name = ?");
      values.push(data.name);
    }
    if (data.price !== undefined) {
      fields.push("price = ?");
      values.push(data.price);
    }
    if (data.is_active !== undefined) {
      fields.push("is_active = ?");
      values.push(data.is_active);
    }
    if (data.stock_status !== undefined) {
      fields.push("stock_status = ?");
      values.push(data.stock_status);
    }
    if (data.notes !== undefined) {
      fields.push("notes = ?");
      values.push(data.notes);
    }

    if (fields.length === 0) return BundleService.getById(tenantId, id);

    db.prepare(
      `UPDATE catalog_bundles SET ${fields.join(", ")}, updated_at = unixepoch('now', 'subsec') * 1000
       WHERE id = ? AND tenant_id = ?`,
    ).run(...values, id, tenantId);
    return BundleService.getById(tenantId, id);
  },

  /** Same allowlist rule as `update`, applied to every id in the batch. */
  bulkUpdate: (
    tenantId: string,
    ids: string[],
    updates: Partial<Pick<Bundle, "is_active" | "stock_status">>,
  ): number => {
    const data = updates ?? {};
    const fields: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (data.is_active !== undefined) {
      fields.push("is_active = ?");
      values.push(data.is_active);
    }
    if (data.stock_status !== undefined) {
      fields.push("stock_status = ?");
      values.push(data.stock_status);
    }

    if (fields.length === 0 || ids.length === 0) return 0;

    const placeholders = ids.map(() => "?").join(",");

    const result = db
      .prepare(
        `UPDATE catalog_bundles SET ${fields.join(", ")}, updated_at = unixepoch('now', 'subsec') * 1000
         WHERE tenant_id = ? AND id IN (${placeholders})`,
      )
      .run(...values, tenantId, ...ids);
    return result.changes;
  },

  updateImage: async (
    tenantId: string,
    id: string,
    newImageId: string,
  ): Promise<Bundle> => {
    const existing = BundleService.getById(tenantId, id);
    if (!existing) throw new Error("Bundle not found");

    await releaseImage(tenantId, id, existing.image_id);

    db.prepare(
      `UPDATE catalog_bundles SET image_id = ?, updated_at = unixepoch('now', 'subsec') * 1000
       WHERE id = ? AND tenant_id = ?`,
    ).run(newImageId, id, tenantId);
    return BundleService.getById(tenantId, id)!;
  },

  delete: async (tenantId: string, id: string): Promise<void> => {
    const bundle = BundleService.getById(tenantId, id);
    if (bundle) {
      await releaseImage(tenantId, id, bundle.image_id);
    }
    db.prepare(
      "DELETE FROM catalog_bundles WHERE id = ? AND tenant_id = ?",
    ).run(id, tenantId);
  },

  getAvailableCategories: (
    tenantId: string,
    segment?: "gaso" | "fnb",
  ): string[] => {
    const params: SQLQueryBindings[] = [tenantId];
    let sql = `SELECT DISTINCT b.primary_category as category FROM catalog_bundles b
       JOIN catalog_periods p ON b.period_id = p.id AND p.tenant_id = b.tenant_id
       WHERE b.tenant_id = ? AND p.status = 'active' AND b.is_active = 1
         AND b.stock_status != 'out_of_stock'`;

    if (segment) {
      sql += " AND b.segment = ?";
      params.push(segment);
    }

    sql += " ORDER BY b.primary_category";

    return getAll<{ category: string }>(sql, params).map((r) => r.category);
  },

  getAffordableCategories: (
    tenantId: string,
    segment: "gaso" | "fnb",
    creditLine: number,
  ): string[] => {
    const rows = getAll<{ category: string }>(
      `SELECT DISTINCT b.primary_category as category FROM catalog_bundles b
       JOIN catalog_periods p ON b.period_id = p.id AND p.tenant_id = b.tenant_id
       WHERE b.tenant_id = ?
         AND p.status = 'active' AND b.is_active = 1 AND b.stock_status != 'out_of_stock'
         AND b.segment = ?
         ${segment === "gaso" ? "AND b.price <= ?" : ""}
       ORDER BY b.primary_category`,
      segment === "gaso"
        ? [tenantId, segment, creditLine]
        : [tenantId, segment],
    );
    return rows.map((r) => r.category);
  },

  /**
   * Get ALL categories that exist in the bundles table (taxonomy),
   * regardless of whether they are currently active or in stock.
   * Used for "We don't have that right now" vs "We never have that" distinction.
   */
  getAllCategories: (tenantId: string): string[] => {
    const rows = getAll<{ category: string }>(
      `SELECT DISTINCT primary_category as category FROM catalog_bundles
       WHERE tenant_id = ? ORDER BY primary_category`,
      [tenantId],
    );
    return rows.map((r) => r.category);
  },

  /**
   * Check if a specific product exists in the active catalog for a category.
   */
  hasProduct: (
    tenantId: string,
    category: string,
    productQuery: string,
  ): boolean => {
    const row = getOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM catalog_bundles b
       JOIN catalog_periods p ON b.period_id = p.id AND p.tenant_id = b.tenant_id
       WHERE b.tenant_id = ?
         AND p.status = 'active'
         AND b.is_active = 1
         AND b.stock_status != 'out_of_stock'
         AND b.primary_category = ?
         AND b.name LIKE ?`,
      [tenantId, category, `%${productQuery}%`],
    );
    return (row?.count || 0) > 0;
  },
};

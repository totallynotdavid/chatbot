import { db } from "../../db/index.ts";
import { getOne, getAll, tenantPredicate } from "../../db/query.ts";
import type { Product } from "@vendeya/types";
import type { SQLQueryBindings } from "bun:sqlite";

/**
 * `tenantId` null reads across tenants (platform operators only). Writes always
 * take a concrete tenant.
 */
export const ProductService = {
  getAll: (tenantId: string | null): Product[] =>
    getAll<Product>(
      `SELECT * FROM products WHERE ${tenantPredicate(tenantId)}
       ORDER BY category, name`,
      tenantId ? [tenantId] : [],
    ),

  getByCategory: (tenantId: string | null, category: string): Product[] =>
    getAll<Product>(
      `SELECT * FROM products WHERE category = ? AND ${tenantPredicate(tenantId)}
       ORDER BY name`,
      tenantId ? [category, tenantId] : [category],
    ),

  getById: (tenantId: string | null, id: string): Product | null =>
    getOne<Product>(
      `SELECT * FROM products WHERE id = ? AND ${tenantPredicate(tenantId)}`,
      tenantId ? [id, tenantId] : [id],
    ) ?? null,

  create: (data: {
    id: string;
    tenantId: string;
    name: string;
    category: string;
    brand?: string;
    model?: string;
    specs_json?: string;
  }): Product => {
    db.prepare(
      `INSERT INTO products (id, tenant_id, name, category, brand, model, specs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      data.id,
      data.tenantId,
      data.name,
      data.category,
      data.brand || null,
      data.model || null,
      data.specs_json || null,
    );
    return ProductService.getById(data.tenantId, data.id)!;
  },

  update: (
    tenantId: string,
    id: string,
    data: Partial<Product>,
  ): Product | null => {
    const fields: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (data.name !== undefined) {
      fields.push("name = ?");
      values.push(data.name);
    }
    if (data.category !== undefined) {
      fields.push("category = ?");
      values.push(data.category);
    }
    if (data.brand !== undefined) {
      fields.push("brand = ?");
      values.push(data.brand);
    }
    if (data.model !== undefined) {
      fields.push("model = ?");
      values.push(data.model);
    }
    if (data.specs_json !== undefined) {
      fields.push("specs_json = ?");
      values.push(data.specs_json);
    }

    if (fields.length === 0) return ProductService.getById(tenantId, id);

    values.push(id, tenantId);
    db.prepare(
      `UPDATE products SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
    ).run(...values);
    return ProductService.getById(tenantId, id);
  },

  getCategories: (tenantId: string | null): string[] => {
    const rows = getAll<{ category: string }>(
      `SELECT DISTINCT category FROM products
       WHERE ${tenantPredicate(tenantId)}
       ORDER BY category`,
      tenantId ? [tenantId] : [],
    );
    return rows.map((r) => r.category);
  },

  /**
   * Get active categories for a segment based on available bundles
   * Only returns categories that have active, in-stock bundles
   */
  getActiveCategoriesBySegment: (
    tenantId: string,
    segment: "fnb" | "gaso",
  ): string[] => {
    const rows = getAll<{ category: string }>(
      `SELECT DISTINCT b.primary_category as category
       FROM catalog_bundles b
       JOIN catalog_periods p ON b.period_id = p.id AND p.tenant_id = b.tenant_id
       WHERE b.tenant_id = ?
         AND p.status = 'active'
         AND b.is_active = 1
         AND b.stock_status != 'out_of_stock'
         AND b.segment = ?
       ORDER BY b.primary_category`,
      [tenantId, segment],
    );
    return rows.map((r) => r.category);
  },

  /**
   * Get all active brands from products involved in active, in-stock bundles.
   */
  getActiveBrands: (tenantId: string): string[] => {
    const rows = getAll<{ brand: string }>(
      `SELECT DISTINCT p.brand
       FROM catalog_bundles b
       JOIN catalog_periods p_desc ON b.period_id = p_desc.id AND p_desc.tenant_id = b.tenant_id,
            json_tree(b.composition_json) as ref
       JOIN products p ON p.id = ref.value AND p.tenant_id = b.tenant_id
       WHERE b.tenant_id = ?
         AND p_desc.status = 'active'
         AND b.is_active = 1
         AND b.stock_status != 'out_of_stock'
         AND ref.key = 'id'
         AND p.brand IS NOT NULL
         AND p.brand != ''
       ORDER BY p.brand`,
      [tenantId],
    );
    return rows.map((r) => r.brand);
  },
};

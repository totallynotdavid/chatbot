import { db } from "../../db/index.ts";
import { getOne, getAll } from "../../db/query.ts";
import type { Product } from "@totem/types";

export const ProductService = {
  getAll: (): Product[] => {
    return getAll<Product>("SELECT * FROM products ORDER BY category, name");
  },

  getByCategory: (category: string): Product[] => {
    return getAll<Product>(
      "SELECT * FROM products WHERE category = ? ORDER BY name",
      [category],
    );
  },

  getById: (id: string): Product | null => {
    return getOne<Product>("SELECT * FROM products WHERE id = ?", [id]) || null;
  },

  create: (data: {
    id: string;
    name: string;
    category: string;
    brand?: string;
    model?: string;
    specs_json?: string;
  }): Product => {
    db.prepare(
      `INSERT INTO products (id, name, category, brand, model, specs_json) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      data.id,
      data.name,
      data.category,
      data.brand || null,
      data.model || null,
      data.specs_json || null,
    );
    return ProductService.getById(data.id)!;
  },

  update: (id: string, data: Partial<Product>): Product => {
    const fields: string[] = [];
    const values: any[] = [];

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

    if (fields.length === 0) return ProductService.getById(id)!;

    values.push(id);
    db.prepare(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`).run(
      ...values,
    );
    return ProductService.getById(id)!;
  },

  getCategories: (): string[] => {
    const rows = getAll<{ category: string }>(
      "SELECT DISTINCT category FROM products ORDER BY category",
    );
    return rows.map((r) => r.category);
  },

  /**
   * Get active categories for a segment based on available bundles
   * Only returns categories that have active, in-stock bundles
   */
  getActiveCategoriesBySegment: (segment: "fnb" | "gaso"): string[] => {
    const rows = getAll<{ category: string }>(
      `SELECT DISTINCT b.primary_category as category
       FROM catalog_bundles b
       JOIN catalog_periods p ON b.period_id = p.id
       WHERE p.status = 'active'
         AND b.is_active = 1
         AND b.stock_status != 'out_of_stock'
         AND b.segment = ?
       ORDER BY b.primary_category`,
      [segment],
    );
    return rows.map((r) => r.category);
  },

  /**
   * Get all active brands from products involved in active, in-stock bundles.
   */
  getActiveBrands: (): string[] => {
    const rows = getAll<{ brand: string }>(
      `SELECT DISTINCT p.brand
       FROM catalog_bundles b
       JOIN catalog_periods p_desc ON b.period_id = p_desc.id,
            json_tree(b.composition_json) as ref
       JOIN products p ON p.id = ref.value
       WHERE p_desc.status = 'active'
         AND b.is_active = 1
         AND b.stock_status != 'out_of_stock'
         AND ref.key = 'id'
         AND p.brand IS NOT NULL
         AND p.brand != ''
       ORDER BY p.brand`,
    );
    return rows.map((r) => r.brand);
  },
};

import { db } from "../../db/index.ts";
import { getOne, getAll } from "../../db/query.ts";
import type { Product } from "@totem/types";

function formatProduct(row: Product): Product {
  return {
    ...row,
    created_at: new Date(row.created_at).toISOString(),
  };
}

export const ProductService = {
  getAll: (): Product[] => {
    const rows = getAll<Product>("SELECT * FROM products ORDER BY category, name");
    return rows.map(formatProduct);
  },

  getByCategory: (category: string): Product[] => {
    const rows = getAll<Product>(
      "SELECT * FROM products WHERE category = ? ORDER BY name",
      [category]
    );
    return rows.map(formatProduct);
  },

  getById: (id: string): Product | null => {
    const row = getOne<Product>("SELECT * FROM products WHERE id = ?", [id]);
    return row ? formatProduct(row) : null;
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
      "SELECT DISTINCT category FROM products ORDER BY category"
    );
    return rows.map((r) => r.category);
  },
};

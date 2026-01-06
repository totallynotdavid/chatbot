import { db } from "../../db/index.ts";
import type { Product } from "@totem/types";

function formatProduct(row: any): Product {
  return {
    ...row,
    created_at: new Date(row.created_at).toISOString(),
  };
}

export const ProductService = {
  getAll: (): Product[] => {
    const rows = db.prepare("SELECT * FROM products ORDER BY category, name").all() as any[];
    return rows.map(formatProduct);
  },

  getByCategory: (category: string): Product[] => {
    const rows = db.prepare("SELECT * FROM products WHERE category = ? ORDER BY name").all(category) as any[];
    return rows.map(formatProduct);
  },

  getById: (id: string): Product | null => {
    const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id) as any;
    return row ? formatProduct(row) : null;
  },

  create: (data: { id: string; name: string; category: string; brand?: string; model?: string; specs_json?: string }): Product => {
    db.prepare(
      `INSERT INTO products (id, name, category, brand, model, specs_json) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(data.id, data.name, data.category, data.brand || null, data.model || null, data.specs_json || null);
    return ProductService.getById(data.id)!;
  },

  getCategories: (): string[] => {
    const rows = db.prepare("SELECT DISTINCT category FROM products ORDER BY category").all() as Array<{ category: string }>;
    return rows.map((r) => r.category);
  },
};

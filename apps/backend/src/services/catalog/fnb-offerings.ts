import { db } from "../../db/index.ts";
import type { FnbOffering, StockStatus } from "@totem/types";
import { imageStorage } from "../image-storage.ts";

type FnbFilters = {
  periodId?: string;
  maxPrice?: number;
  category?: string;
};

function formatOffering(row: any): FnbOffering {
  return {
    ...row,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export const FnbOfferingService = {
  /** Get all offerings for a period (dashboard) */
  getByPeriod: (periodId: string): FnbOffering[] => {
    const rows = db.prepare(
      "SELECT * FROM catalog_fnb_offerings WHERE period_id = ? ORDER BY category, price",
    ).all(periodId) as any[];
    return rows.map(formatOffering);
  },

  /** Get available offerings for bot (active period, filters) */
  getAvailable: (filters: FnbFilters = {}): FnbOffering[] => {
    let query = `
      SELECT f.* FROM catalog_fnb_offerings f
      JOIN catalog_periods p ON f.period_id = p.id
      WHERE p.status = 'active'
        AND f.is_active = 1
        AND f.stock_status != 'out_of_stock'
    `;
    const params: any[] = [];

    if (filters.maxPrice !== undefined) {
      query += " AND f.price <= ?";
      params.push(filters.maxPrice);
    }

    if (filters.category) {
      query += " AND f.category = ?";
      params.push(filters.category);
    }

    query += " ORDER BY f.price ASC";

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map(formatOffering);
  },

  getById: (id: string): FnbOffering | null => {
    const row = db.prepare("SELECT * FROM catalog_fnb_offerings WHERE id = ?").get(id) as any;
    return row ? formatOffering(row) : null;
  },

  create: (data: {
    id: string;
    period_id: string;
    product_id: string;
    product_snapshot_json: string;
    price: number;
    category: string;
    installments?: number;
    image_id: string;
    created_by: string | null;
  }): FnbOffering => {
    db.prepare(`
      INSERT INTO catalog_fnb_offerings (id, period_id, product_id, product_snapshot_json, price, category, installments, image_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      data.period_id,
      data.product_id,
      data.product_snapshot_json,
      data.price,
      data.category,
      data.installments || null,
      data.image_id,
      data.created_by,
    );
    return FnbOfferingService.getById(data.id)!;
  },

  update: (id: string, updates: Partial<Pick<FnbOffering, "price" | "installments" | "is_active" | "stock_status">>): FnbOffering => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return FnbOfferingService.getById(id)!;

    const fields = entries.map(([k]) => `${k} = ?`).join(", ");
    const values = entries.map(([, v]) => v);

    db.prepare(`UPDATE catalog_fnb_offerings SET ${fields}, updated_at = unixepoch('now', 'subsec') * 1000 WHERE id = ?`).run(...values, id);
    return FnbOfferingService.getById(id)!;
  },

  bulkUpdate: (ids: string[], updates: Partial<Pick<FnbOffering, "is_active" | "stock_status">>): number => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0 || ids.length === 0) return 0;

    const fields = entries.map(([k]) => `${k} = ?`).join(", ");
    const values = entries.map(([, v]) => v);
    const placeholders = ids.map(() => "?").join(",");

    const result = db.prepare(
      `UPDATE catalog_fnb_offerings SET ${fields}, updated_at = unixepoch('now', 'subsec') * 1000 WHERE id IN (${placeholders})`,
    ).run(...values, ...ids);
    return result.changes;
  },

  updateImage: async (id: string, newImageId: string): Promise<FnbOffering> => {
    const existing = FnbOfferingService.getById(id);
    if (!existing) throw new Error("Offering not found");

    await imageStorage.delete(existing.image_id);
    db.prepare(`UPDATE catalog_fnb_offerings SET image_id = ?, updated_at = unixepoch('now', 'subsec') * 1000 WHERE id = ?`).run(newImageId, id);
    return FnbOfferingService.getById(id)!;
  },

  delete: async (id: string): Promise<void> => {
    const offering = FnbOfferingService.getById(id);
    if (offering) {
      await imageStorage.delete(offering.image_id);
    }
    db.prepare("DELETE FROM catalog_fnb_offerings WHERE id = ?").run(id);
  },

  getAvailableCategories: (): string[] => {
    const rows = db.prepare(`
      SELECT DISTINCT f.category FROM catalog_fnb_offerings f
      JOIN catalog_periods p ON f.period_id = p.id
      WHERE p.status = 'active' AND f.is_active = 1 AND f.stock_status != 'out_of_stock'
      ORDER BY f.category
    `).all() as Array<{ category: string }>;
    return rows.map((r) => r.category);
  },
};

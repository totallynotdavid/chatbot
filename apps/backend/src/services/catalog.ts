import { db } from "../db/index.ts";
import type { Product, Segment, StockStatus } from "@totem/types";

type CreateProductData = {
    id: string;
    segment: Segment;
    category: string;
    name: string;
    description: string | null;
    price: number;
    installments: number | null;
    image_main_path: string;
    image_specs_path: string | null;
    created_by: string;
};

export const CatalogService = {
    getAll: () => {
        return db
            .prepare("SELECT * FROM catalog_products ORDER BY updated_at DESC")
            .all() as Product[];
    },

    getBySegment: (segment: Segment) => {
        return db
            .prepare(`
            SELECT * FROM catalog_products 
            WHERE segment = ? AND is_active = 1 AND stock_status != 'out_of_stock'
        `)
            .all(segment) as Product[];
    },

    create: (data: CreateProductData) => {
        const stmt = db.prepare(`
            INSERT INTO catalog_products (
                id, segment, category, name, description, price, installments,
                image_main_path, image_specs_path, is_active, stock_status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            data.id,
            data.segment,
            data.category,
            data.name,
            data.description,
            data.price,
            data.installments,
            data.image_main_path,
            data.image_specs_path,
            1,
            "in_stock",
            data.created_by,
        );
        return data;
    },

    update: (
        id: string,
        updates: Partial<
            Pick<
                Product,
                | "name"
                | "description"
                | "price"
                | "installments"
                | "category"
                | "is_active"
                | "stock_status"
            >
        >,
    ) => {
        const entries = Object.entries(updates);
        if (entries.length === 0) {
            return db
                .prepare("SELECT * FROM catalog_products WHERE id = ?")
                .get(id) as Product;
        }
        const fields = entries.map(([k]) => `${k} = ?`).join(", ");
        const values: (string | number | StockStatus | null)[] = entries.map(
            ([, v]) => v as string | number | StockStatus | null,
        );
        db.prepare(
            `UPDATE catalog_products SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).run(...values, id);
        return db
            .prepare("SELECT * FROM catalog_products WHERE id = ?")
            .get(id) as Product;
    },

    bulkUpdate: (
        ids: string[],
        updates: Partial<Pick<Product, "is_active" | "stock_status">>,
    ) => {
        const entries = Object.entries(updates);
        if (entries.length === 0 || ids.length === 0) return 0;

        const fields = entries.map(([k]) => `${k} = ?`).join(", ");
        const values = entries.map(([, v]) => v);
        const placeholders = ids.map(() => "?").join(",");

        const stmt = db.prepare(
            `UPDATE catalog_products SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
        );
        const result = stmt.run(...values, ...ids);
        return result.changes;
    },

    updateImages: (id: string, mainPath?: string, specsPath?: string) => {
        if (mainPath && specsPath) {
            db.prepare(
                `UPDATE catalog_products SET image_main_path = ?, image_specs_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            ).run(mainPath, specsPath, id);
        } else if (mainPath) {
            db.prepare(
                `UPDATE catalog_products SET image_main_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            ).run(mainPath, id);
        } else if (specsPath) {
            db.prepare(
                `UPDATE catalog_products SET image_specs_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            ).run(specsPath, id);
        }
        return db
            .prepare("SELECT * FROM catalog_products WHERE id = ?")
            .get(id) as Product;
    },

    delete: (id: string) => {
        db.prepare("DELETE FROM catalog_products WHERE id = ?").run(id);
    },

    getAvailableCategories: (segment?: Segment) => {
        const query = segment
            ? `SELECT DISTINCT category FROM catalog_products 
               WHERE segment = ? AND is_active = 1 AND stock_status != 'out_of_stock'
               ORDER BY category`
            : `SELECT DISTINCT category FROM catalog_products 
               WHERE is_active = 1 AND stock_status != 'out_of_stock'
               ORDER BY category`;
        
        const rows = segment 
            ? db.prepare(query).all(segment) as Array<{ category: string }>
            : db.prepare(query).all() as Array<{ category: string }>;
        
        return rows.map(r => r.category);
    },
};

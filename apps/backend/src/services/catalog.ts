import { db } from "../db";
import type { Product, Segment, StockStatus } from "@totem/types";

type CreateProductData = {
    id: string;
    segment: Segment;
    category: string;
    name: string;
    description: string | null;
    price: number;
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
                id, segment, category, name, description, price, 
                image_main_path, image_specs_path, is_active, stock_status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            data.id,
            data.segment,
            data.category,
            data.name,
            data.description,
            data.price,
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
                "name" | "description" | "price" | "is_active" | "stock_status"
            >
        >,
    ) => {
        const entries = Object.entries(updates);
        if (entries.length === 0) return;
        const fields = entries.map(([k]) => `${k} = ?`).join(", ");
        const values: (string | number | StockStatus)[] = entries.map(
            ([, v]) => v as string | number | StockStatus,
        );
        db.prepare(
            `UPDATE catalog_products SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).run(...values, id);
    },

    delete: (id: string) => {
        db.prepare("DELETE FROM catalog_products WHERE id = ?").run(id);
    },
};

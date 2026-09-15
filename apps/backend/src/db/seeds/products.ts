import type { Database } from "bun:sqlite";
import { tenantScopedId } from "../../domains/catalog/ids.ts";
import { BASE_PRODUCTS } from "../seed-data/products.ts";

export async function seedProducts(db: Database, tenantId: string) {
  const exists = db
    .prepare("SELECT count(*) as count FROM products WHERE tenant_id = ?")
    .get(tenantId) as { count: number };

  if (exists.count > 0) {
    return;
  }

  const stmt = db.prepare(
    `INSERT INTO products (id, tenant_id, name, category, brand, model, specs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const product of BASE_PRODUCTS) {
    stmt.run(
      // The base catalog's ids are shared by every tenant seeded from it, so
      // they are scoped to this one before they reach the global primary key.
      tenantScopedId(tenantId, product.id),
      tenantId,
      product.name,
      product.category,
      product.brand,
      product.model,
      JSON.stringify(product.specs),
    );
  }
}

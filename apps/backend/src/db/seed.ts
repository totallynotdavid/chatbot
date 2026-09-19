import type { Database } from "bun:sqlite";
import process from "node:process";
import { db } from "./connection.ts";
import { initializeDatabase } from "./init.ts";
import { seedPeriods } from "./seeds/periods.ts";
import { seedProducts } from "./seeds/products.ts";
import { seedBundles } from "./seeds/bundles.ts";
import { seedCatalogImages } from "./seeds/images.ts";
import { seedTestData } from "./seeds/test-data.ts";
import { seedTenants } from "./seeds/tenants.ts";

export async function seedDatabase(database: Database) {
  // Tenancy first: every other seed needs a tenant to belong to.
  const { tenant, channelAccount } = seedTenants(database);

  await seedPeriods(database, tenant.id);
  await seedProducts(database, tenant.id);
  await seedBundles(database, tenant.id);
  // Unconditionally, not only when bundles were just seeded: a tenant seeded on
  // an earlier boot still names these images, and the volume they are served
  // from may be new.
  seedCatalogImages();

  if (process.env.NODE_ENV !== "production") {
    await seedTestData(database, tenant.id, channelAccount.id);
  }
}

if (import.meta.main) {
  initializeDatabase(db);
  await seedDatabase(db);
  // No process.exit(): the seed logs, and in production the logger writes to an
  // async file destination that an immediate exit would truncate. Closing the
  // database lets the process end on its own once that flush completes.
  db.close();
}

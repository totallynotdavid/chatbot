import type { Database } from "bun:sqlite";
import process from "node:process";
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

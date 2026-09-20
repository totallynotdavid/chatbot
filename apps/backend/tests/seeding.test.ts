/**
 * The seeds run on every boot, so a throw takes the process down.
 * Foreign keys are enforced on the temporary databases as `connection.ts`
 * enforces them on the real one. A bundle naming a missing period fails here
 * as it would in production.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeDatabase } from "../src/db/init.ts";
import { seedPeriods } from "../src/db/seeds/periods.ts";
import { seedProducts } from "../src/db/seeds/products.ts";
import { seedBundles } from "../src/db/seeds/bundles.ts";
import { tenantsOn } from "../src/domains/tenants/index.ts";
import { periodId } from "../src/domains/catalog/periods.ts";
import { currentPeriodId } from "../src/db/seeds/periods.ts";
import { BASE_PRODUCTS } from "../src/db/seed-data/products.ts";
import { createTestDatabase } from "./helpers/database.ts";

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

describe("seeding a catalog", () => {
  let dir: string;
  let db: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-seeding-"));
    db = createTestDatabase(join(dir, "fresh.sqlite"));
    db.run("PRAGMA foreign_keys = ON;");
    initializeDatabase(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function tenant(slug: string, id?: string): string {
    return tenantsOn(db).create({ slug, name: slug, id }).id;
  }

  async function seedCatalog(tenantId: string): Promise<void> {
    await seedPeriods(db, tenantId);
    await seedProducts(db, tenantId);
    await seedBundles(db, tenantId);
  }

  function periods(
    tenantId: string,
  ): Array<{ year_month: string; status: string }> {
    return db
      .prepare(
        "SELECT year_month, status FROM catalog_periods WHERE tenant_id = ? ORDER BY year_month",
      )
      .all(tenantId) as Array<{ year_month: string; status: string }>;
  }

  /** The period a tenant onboarded in, months ago. */
  function olderPeriod(tenantId: string): string {
    const id = periodId(tenantId, "2020-01");

    db.prepare(
      `INSERT INTO catalog_periods (id, tenant_id, name, year_month, status)
       VALUES (?, ?, 'Enero 2020', '2020-01', 'active')`,
    ).run(id, tenantId);

    return id;
  }

  function insertBundle(tenantId: string, period: string): void {
    db.prepare(
      `INSERT INTO catalog_bundles
         (id, tenant_id, period_id, segment, name, price, primary_category,
          categories_json, image_id, composition_json, installments_json)
       VALUES (?, ?, ?, 'gaso', 'Combo propio', 999, 'celulares', '[]', 'img', '{}', '{}')`,
    ).run(`bundle-${crypto.randomUUID()}`, tenantId, period);
  }

  function bundleCount(tenantId: string): number {
    return (
      db
        .prepare(
          "SELECT COUNT(*) as count FROM catalog_bundles WHERE tenant_id = ?",
        )
        .get(tenantId) as { count: number }
    ).count;
  }

  // The period seed must create the current month's period if it doesn't exist,
  // so bundles can be seeded into it.
  it("seeds a tenant whose only period predates this month", async () => {
    const tenantId = tenant("migrated");
    olderPeriod(tenantId);

    await seedCatalog(tenantId);

    expect(periods(tenantId)).toEqual([
      { year_month: "2020-01", status: "active" },
      // The live catalog is left alone. The new month arrives as a draft.
      { year_month: currentYearMonth(), status: "draft" },
    ]);

    expect(bundleCount(tenantId)).toBeGreaterThan(0);
    expect(
      db
        .prepare(
          "SELECT DISTINCT period_id FROM catalog_bundles WHERE tenant_id = ?",
        )
        .all(tenantId),
    ).toEqual([{ period_id: currentPeriodId(tenantId) }]);
  });

  it("leaves a tenant's own catalog alone when the month rolls over", async () => {
    const tenantId = tenant("rollover");
    const period = olderPeriod(tenantId);
    insertBundle(tenantId, period);

    await seedCatalog(tenantId);

    // The base catalog is bootstrap data for a new tenant, not something poured
    // into every month on top of what the business actually sells.
    expect(bundleCount(tenantId)).toBe(1);
    expect(periods(tenantId)).toHaveLength(2);
  });

  it("gives a brand-new tenant an active period to sell from", async () => {
    const tenantId = tenant("fresh");
    await seedCatalog(tenantId);

    expect(periods(tenantId)).toEqual([
      { year_month: currentYearMonth(), status: "active" },
    ]);
  });

  // Product ids embed enough of the tenant id to stay unique when tenant ids
  // share a prefix.
  it("keeps two tenants whose ids share a prefix apart", async () => {
    const first = tenant("prefix-one", "aaaaaaaa-1111-4111-8111-111111111111");
    const second = tenant("prefix-two", "aaaaaaaa-2222-4222-8222-222222222222");

    await seedCatalog(first);
    await seedCatalog(second);

    for (const tenantId of [first, second]) {
      const products = db
        .prepare("SELECT COUNT(*) as count FROM products WHERE tenant_id = ?")
        .get(tenantId) as { count: number };

      expect(products.count).toBe(BASE_PRODUCTS.length);
      expect(bundleCount(tenantId)).toBeGreaterThan(0);
    }
  });
});

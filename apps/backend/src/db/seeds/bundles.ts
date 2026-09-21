import type { Database } from "bun:sqlite";
import { currentPeriodId } from "./periods.ts";
import { tenantScopedId } from "../../domains/catalog/ids.ts";
import { BUNDLES_SEED } from "../seed-data/bundles.ts";
import { FNB_BUNDLES_SEED } from "../seed-data/fnb-bundles.ts";
import type { BundleComposition, SnapshotProduct } from "@vendeya/types";

const BUNDLE_NOTES =
  "01 año de garantía, delivery gratuito, cero cuota inicial";

/**
 * A bundle's composition snapshots the products it is made of by id, and those
 * ids are scoped to the tenant when the product rows are seeded (see
 * `seedProducts`). The snapshots have to name the same rows, or the catalog
 * queries that join composition back to `products` find nothing.
 */
function scopeComposition(
  tenantId: string,
  composition: BundleComposition,
): BundleComposition {
  const scope = (product: SnapshotProduct): SnapshotProduct => ({
    ...product,
    id: tenantScopedId(tenantId, product.id),
  });

  return {
    fixed: composition.fixed.map(scope),
    choices: composition.choices.map((choice) => ({
      ...choice,
      options: choice.options.map(scope),
    })),
  };
}

/**
 * The base catalog, as one tenant's starting point. It is bootstrap data, so a
 * tenant that already has bundles keeps them: re-seeding per period would push
 * the sample catalog into every new month on top of the tenant's real one.
 */
export async function seedBundles(db: Database, tenantId: string) {
  const periodId = currentPeriodId(tenantId);

  const exists = db
    .prepare(
      "SELECT count(*) as count FROM catalog_bundles WHERE tenant_id = ?",
    )
    .get(tenantId) as { count: number };

  if (exists.count > 0) {
    return;
  }

  const stmt = db.prepare(
    `INSERT INTO catalog_bundles (
      id, tenant_id, period_id, segment, name, price, primary_category,
      categories_json, image_id, composition_json, installments_json, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const seeds = [
    { segment: "gaso" as const, bundles: BUNDLES_SEED, prefix: "bundle" },
    { segment: "fnb" as const, bundles: FNB_BUNDLES_SEED, prefix: "fnb" },
  ];

  for (const { segment, bundles, prefix } of seeds) {
    for (const bundle of bundles) {
      stmt.run(
        tenantScopedId(tenantId, `${prefix}-${bundle.image_id}`),
        tenantId,
        periodId,
        segment,
        bundle.name,
        bundle.price,
        bundle.primary_category,
        JSON.stringify(bundle.categories),
        bundle.image_id,
        JSON.stringify(scopeComposition(tenantId, bundle.composition)),
        JSON.stringify(bundle.installments),
        BUNDLE_NOTES,
      );
    }
  }
}

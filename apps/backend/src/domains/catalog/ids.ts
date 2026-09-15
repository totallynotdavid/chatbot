/**
 * Ids for catalog rows that are addressed by a readable handle rather than a
 * random one: the monthly period, and everything the seed creates from the base
 * catalog.
 *
 * `products.id`, `catalog_bundles.id` and `catalog_periods.id` are global
 * primary keys, so the handle has to carry the tenant. Without it the second
 * business seeded from the same base catalog collides with the first, and
 * onboarding fails on `UNIQUE constraint failed: products.id`.
 */
export function tenantScopedId(tenantId: string, key: string): string {
  // The whole tenant id, not a prefix of it: shortening it to 8 hex characters
  // left two tenants whose ids happen to share that prefix colliding on exactly
  // the constraint this function exists to keep clear of. The id is a handle,
  // not something anyone types, so its length costs nothing.
  return `${key}-${tenantId.replace(/-/g, "")}`;
}

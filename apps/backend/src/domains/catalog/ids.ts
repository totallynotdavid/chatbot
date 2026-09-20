/**
 * `products.id`, `catalog_bundles.id` and `catalog_periods.id` are global
 * primary keys. A readable handle for a seeded row must carry the tenant, or
 * the second tenant seeded from the base catalog fails on the UNIQUE constraint.
 */
export function tenantScopedId(tenantId: string, key: string): string {
  // The whole tenant id, not a prefix. Two tenants whose ids share a prefix
  // would collide on the same constraint. Nobody types the handle, so its length
  // costs nothing.
  return `${key}-${tenantId.replace(/-/g, "")}`;
}

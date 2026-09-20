export function showTenantSelector(session: {
  tenantCount: number;
  activeTenantId: string | null;
  isPlatformOperator: boolean;
}): boolean {
  // A platform operator's unpinned "all tenants" view is itself an option.
  // They may also pin any open tenant, so the selector always applies to them.
  if (session.isPlatformOperator) return true;

  // A member with nothing pinned gets a 403 from every route behind
  // `requireTenantScope`. One membership is enough to show the selector,
  // because the backend drops the pin when the membership is revoked or the
  // tenant is suspended (platform/auth/session.ts) and the user must be able to
  // pin again.
  if (!session.activeTenantId) return session.tenantCount > 0;

  // With a tenant pinned, the selector only helps when another tenant exists.
  return session.tenantCount > 1;
}

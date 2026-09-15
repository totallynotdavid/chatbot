/**
 * Whether the tenant selector belongs in the nav.
 *
 * The question is not "does this user have somewhere else to switch to". A
 * member with a single membership can still end up with nothing pinned: the
 * backend re-reads membership on every request and drops the pin when the user
 * is no longer a member of the tenant the session names
 * (platform/auth/session.ts), which is also what happens after being removed
 * from the tenant they were working in. With one membership left and a
 * "somewhere else to go" test, the selector disappeared at exactly that moment
 * - and with no active tenant every tenant-scoped page answers 403, so the only
 * way back was to log out and in again.
 *
 * So the selector appears whenever there is nothing pinned and something to
 * pin, not only when there is a choice between two.
 */
export function showTenantSelector(session: {
  tenantCount: number;
  activeTenantId: string | null;
  isPlatformOperator: boolean;
}): boolean {
  // A platform operator's unpinned "all tenants" view is itself one of the
  // options, and they may pin any tenant, so the selector is always theirs.
  if (session.isPlatformOperator) return true;

  // Nothing pinned: one membership is enough, because it still has to be
  // chosen before anything tenant-scoped works.
  if (!session.activeTenantId) return session.tenantCount > 0;

  // Already pinned: only worth showing when there is somewhere else to go.
  return session.tenantCount > 1;
}

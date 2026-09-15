/**
 * Authorization scope carried by a session.
 *
 * Two kinds of caller exist:
 *
 *  - a tenant member, always pinned to exactly one tenant, whose permissions
 *    come from their membership role;
 *  - a VendeYa platform operator, who is a member of no tenant but may act
 *    across all of them for support. They may pin themselves to one tenant
 *    (so writes have somewhere to land); unpinned, their reads span tenants.
 *
 * `tenantId === null` therefore means "not scoped to one tenant" and is only
 * ever reachable by a platform operator.
 */

import type { TenantRole } from "@totem/types";
import { TenantService } from "../../domains/tenants/index.ts";

export type AuthScope = {
  userId: string;
  tenantId: string | null;
  /** The caller's own membership in `tenantId`. Authority comes from `sessionRole`. */
  membershipRole: TenantRole | null;
  isPlatformOperator: boolean;
};

/** Roles a platform operator is treated as holding for RBAC checks. */
const PLATFORM_OPERATOR_ROLE: TenantRole = "admin";

/**
 * The role a session acts with, both as reported to the client and as checked
 * by `requireRole`.
 *
 * A role only exists inside a tenant. A platform operator acts with admin
 * authority everywhere, including in a tenant where they also hold a lesser
 * membership; a member holds whatever their membership says; a user who has not
 * yet picked a tenant holds nothing, and gets null rather than a borrowed role
 * from elsewhere.
 */
export function sessionRole(session: {
  isPlatformOperator: boolean;
  membershipRole: TenantRole | null;
}): TenantRole | null {
  if (session.isPlatformOperator) return PLATFORM_OPERATOR_ROLE;
  return session.membershipRole;
}

export function hasRole(scope: AuthScope, allowed: string[]): boolean {
  const role = sessionRole(scope);
  return role !== null && allowed.includes(role);
}

/**
 * The tenant a write lands in, and the one place that invariant is expressed:
 * a write always needs a concrete tenant, so an unpinned platform operator has
 * to select one first. `requireActiveTenant` and `activeTenantId` in
 * middleware/auth.ts are both this function; nothing writes tenant-owned data
 * without passing through it.
 *
 * Reads are the other half and need no helper: a pinned scope filters to
 * `scope.tenantId`, and null there means "across tenants", which the read
 * services already take.
 */
export function writeTenantId(scope: AuthScope | null | undefined): string {
  if (!scope?.tenantId) {
    throw new TenantScopeRequiredError();
  }
  return scope.tenantId;
}

export class TenantScopeRequiredError extends Error {
  constructor() {
    super("An active tenant must be selected for this operation");
    this.name = "TenantScopeRequiredError";
  }
}

/**
 * Whether `scope` is allowed to touch a row owned by `rowTenantId`.
 *
 * Unpinned platform operators may touch any *open* tenant's row. Suspension is
 * checked here rather than left to the session, because for an operator the
 * session's response to suspension - dropping the pin - is the cross-tenant
 * view itself: it removes nothing. A pinned caller needs no such check, since
 * a pin on a suspended tenant is dropped before the scope is built.
 */
export function canAccessTenant(
  scope: AuthScope,
  rowTenantId: string,
): boolean {
  if (scope.tenantId === null) {
    return scope.isPlatformOperator && TenantService.isOpen(rowTenantId);
  }
  return scope.tenantId === rowTenantId;
}

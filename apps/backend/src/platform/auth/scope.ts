import type { TenantRole } from "@vendeya/types";
import { TenantService } from "../../domains/tenants/index.ts";

/**
 * A session is pinned to at most one tenant. A member acts there with their
 * membership role. A platform operator belongs to no tenant and may pin
 * themselves to one, which scopes their reads and gives their writes somewhere
 * to land.
 */
export type AuthScope = {
  userId: string;
  /**
   * The session's active tenant, or null when none is pinned. An unpinned
   * platform operator gets the cross-tenant view. A member is unpinned until
   * they pick a tenant, or after a revoked membership or suspended tenant drops
   * the pin. `requireTenantScope` refuses an unpinned member with a 403.
   */
  tenantId: string | null;
  /**
   * The caller's own role in `tenantId`. It is null while unpinned, and for an
   * operator pinned to a tenant they are not a member of. Authority comes from
   * `sessionRole`.
   */
  membershipRole: TenantRole | null;
  isPlatformOperator: boolean;
};

/** The role a platform operator is treated as holding for RBAC checks. */
const PLATFORM_OPERATOR_ROLE: TenantRole = "admin";

/**
 * The role a session acts with, as reported to the client and as checked by
 * `requireRole`. A platform operator is admin in every scope, including the
 * cross-tenant view. Anyone else holds the role of their membership in the
 * pinned tenant.
 */
export function sessionRole(session: {
  isPlatformOperator: boolean;
  membershipRole: TenantRole | null;
}): TenantRole | null {
  // An operator is admin even in a tenant where they hold a lesser membership.
  if (session.isPlatformOperator) return PLATFORM_OPERATOR_ROLE;
  // A member has no role while unpinned, and never one from another tenant.
  return session.membershipRole;
}

export function hasRole(scope: AuthScope, allowed: string[]): boolean {
  const role = sessionRole(scope);
  return role !== null && allowed.includes(role);
}

/**
 * The sales agent whose assignments bound this caller, or null when the role
 * sees the whole tenant. The agent reaches conversations assigned to them or
 * to nobody, and only orders from conversations assigned to them. An operator
 * is admin (see `sessionRole`), so an agent membership does not narrow them.
 */
export function assignedAgentScope(scope: AuthScope): string | null {
  return sessionRole(scope) === "sales_agent" ? scope.userId : null;
}

/**
 * The tenant a write lands in. A write needs a concrete tenant, so an unpinned
 * caller, operator or member, throws until one is selected. Request handlers
 * reach this through `activeTenantId` and `requireActiveTenant` in
 * middleware/auth.ts.
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
 * Whether `scope` may touch a row owned by `rowTenantId`. An unpinned platform
 * operator may touch any open tenant's row.
 */
export function canAccessTenant(
  scope: AuthScope,
  rowTenantId: string,
): boolean {
  if (scope.tenantId === null) {
    // Suspension is checked here, not left to the session. Dropping an
    // operator's pin on suspension yields the cross-tenant view, which removes
    // nothing.
    return scope.isPlatformOperator && TenantService.isOpen(rowTenantId);
  }
  // A pin on a suspended tenant is dropped before the scope is built.
  return scope.tenantId === rowTenantId;
}

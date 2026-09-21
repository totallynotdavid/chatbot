import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import {
  validateSessionToken,
  deleteSessionTokenCookie,
  setSessionTokenCookie,
} from "../platform/auth/session.ts";
import {
  hasRole,
  TenantScopeRequiredError,
  writeTenantId,
} from "../platform/auth/scope.ts";

/** Response body for a caller who has no active tenant. */
export const NO_ACTIVE_TENANT = {
  error: "No active tenant",
  detail:
    "Select a tenant with POST /api/tenants/active before using this endpoint",
} as const;

export async function requireAuth(c: Context, next: Next) {
  const token = getCookie(c, "session");

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { session, user, scope, fresh } = validateSessionToken(token);

  if (!session || !user || !scope) {
    deleteSessionTokenCookie(c);
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", user);
  c.set("session", session);
  c.set("scope", scope);

  // The browser drops the cookie at the expiry it was given at login, so a
  // renewed session needs the cookie again. Only then, not on every response.
  if (fresh) setSessionTokenCookie(c, token, session.expiresAt);

  await next();
}

/**
 * Checks the caller's role in the active tenant. A user with no membership in
 * the active tenant has no role and fails every check. A platform operator is
 * treated as admin (see sessionRole in platform/auth/scope.ts).
 */
export function requireRole(...allowedRoles: string[]) {
  return async (c: Context, next: Next) => {
    const scope = c.get("scope");

    if (!scope || !hasRole(scope, allowedRoles)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    await next();
  };
}

/**
 * Gate for routes that read or write tenant-owned data. A caller who is not a
 * platform operator and has no pinned tenant gets a 403, so a member never
 * reaches an unscoped query.
 */
export async function requireTenantScope(c: Context, next: Next) {
  const scope = c.get("scope");

  if (!scope) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (!scope.isPlatformOperator && !scope.tenantId) {
    return c.json(NO_ACTIVE_TENANT, 403);
  }

  await next();
}

/**
 * The tenant a request is acting in. This calls `writeTenantId`. When no tenant
 * is pinned and `requireActiveTenant` is not in front of the handler, it throws
 * TenantScopeRequiredError, which the error handler turns into the same 403.
 */
export function activeTenantId(c: Context): string {
  return writeTenantId(c.get("scope"));
}

/** Gate for routes that write tenant data, which need a concrete tenant. */
export async function requireActiveTenant(c: Context, next: Next) {
  try {
    writeTenantId(c.get("scope"));
  } catch (error) {
    if (error instanceof TenantScopeRequiredError) {
      return c.json(NO_ACTIVE_TENANT, 403);
    }
    throw error;
  }

  await next();
}

/** Gate for routes reserved for VendeYa's own staff. */
export async function requirePlatformOperator(c: Context, next: Next) {
  const scope = c.get("scope");

  if (!scope?.isPlatformOperator) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
}

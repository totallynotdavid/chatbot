import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import {
  validateSessionToken,
  deleteSessionTokenCookie,
} from "../platform/auth/session.ts";
import {
  hasRole,
  TenantScopeRequiredError,
  writeTenantId,
} from "../platform/auth/scope.ts";

/** Body for a caller who has to pick a tenant before this endpoint means anything. */
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

  const { session, user, scope } = validateSessionToken(token);

  if (!session || !user || !scope) {
    deleteSessionTokenCookie(c);
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", user);
  c.set("session", session);
  c.set("scope", scope);

  await next();
}

/**
 * Role check against the caller's role *in the active tenant*. Being logged in
 * is not enough; a user with no membership in the active tenant has no role and
 * fails every check (platform operators excepted, see AuthScope).
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
 * Gate for routes that read or write tenant-owned data. A caller who is neither
 * a member of the active tenant nor a platform operator is refused outright,
 * rather than being handed an unscoped query.
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
 * The tenant a request is acting in. This is `writeTenantId`, so a handler that
 * is reached without `requireActiveTenant` in front of it raises
 * TenantScopeRequiredError (which the error handler turns into the same 403)
 * rather than writing into whichever tenant happened to be around.
 */
export function activeTenantId(c: Context): string {
  return writeTenantId(c.get("scope"));
}

/** Routes that mutate tenant data need a concrete tenant to write into. */
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

/** Routes reserved for VendeYa's own staff. */
export async function requirePlatformOperator(c: Context, next: Next) {
  const scope = c.get("scope");

  if (!scope?.isPlatformOperator) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
}

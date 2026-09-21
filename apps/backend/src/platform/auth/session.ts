import { db } from "../../db/index.ts";
import {
  encodeBase32LowerCaseNoPadding,
  encodeHexLowerCase,
} from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import process from "node:process";
import type { TenantMembership, TenantRole } from "@vendeya/types";
import { MembershipService } from "../../domains/tenants/index.ts";
import type { AuthScope } from "./scope.ts";
import { sessionRole } from "./scope.ts";

const cookieSecure = (() => {
  const flag = process.env.COOKIE_SECURE;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production";
})();

export interface Session {
  id: string;
  userId: string;
  activeTenantId: string | null;
  expiresAt: Date;
}

export interface User {
  id: string;
  username: string;
  /**
   * The role the session acts with, from `sessionRole`. A platform operator is
   * admin in every scope. Anyone else has their membership role in the active
   * tenant, or null while no tenant is selected.
   */
  role: string | null;
  name: string;
  isPlatformOperator: boolean;
  activeTenantId: string | null;
  /**
   * Whether the agent is taking new conversations in the active tenant. It
   * comes from the membership there, so it is false while no tenant is
   * selected and for an operator who is not a member of the pinned tenant.
   */
  isAvailable: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    user: User;
    session: Session;
    scope: AuthScope;
  }
}

/**
 * `fresh` is true when this call pushed the session's expiry out. The browser
 * still holds the cookie with the old expiry, so the caller must send it again.
 */
export type SessionValidationResult =
  | { session: Session; user: User; scope: AuthScope; fresh: boolean }
  | { session: null; user: null; scope: null; fresh: false };

export function generateSessionToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const token = encodeBase32LowerCaseNoPadding(bytes);
  return token;
}

/**
 * Picks the tenant a fresh session starts in. A user with exactly one open
 * membership starts in it. Everyone else starts unpinned. A platform operator
 * chooses explicitly, and a user with several memberships is not put in
 * whichever tenant sorted first.
 */
export function defaultTenantForUser(
  userId: string,
  isPlatformOperator: boolean,
): string | null {
  if (isPlatformOperator) return null;

  const memberships = MembershipService.listForUser(userId);
  return memberships.length === 1 ? memberships[0]!.id : null;
}

export function createSession(
  token: string,
  userId: string,
  activeTenantId: string | null = null,
): Session {
  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
  const session: Session = {
    id: sessionId,
    userId,
    activeTenantId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
  };
  db.prepare(
    "INSERT INTO session (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?)",
  ).run(
    session.id,
    session.userId,
    session.activeTenantId,
    Math.floor(session.expiresAt.getTime() / 1000),
  );
  return session;
}

/**
 * Repoint a session at another tenant. The caller must already have been
 * checked against the target (membership, or platform operator).
 */
export function setSessionTenant(
  sessionId: string,
  tenantId: string | null,
): void {
  db.prepare("UPDATE session SET active_tenant_id = ? WHERE id = ?").run(
    tenantId,
    sessionId,
  );
}

export function validateSessionToken(token: string): SessionValidationResult {
  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
  const row = db
    .prepare(`
        SELECT s.id, s.user_id, s.active_tenant_id, s.expires_at,
               u.id as uid, u.username, u.role, u.name as uname,
               u.is_platform_operator, u.is_active,
               t.status as tenant_status
        FROM session s
        INNER JOIN users u ON u.id = s.user_id
        LEFT JOIN tenants t ON t.id = s.active_tenant_id
        WHERE s.id = ?
    `)
    .get(sessionId) as
    | {
        id: string;
        user_id: string;
        active_tenant_id: string | null;
        expires_at: number;
        uid: string;
        username: string;
        role: string;
        uname: string;
        is_platform_operator: number;
        is_active: number;
        tenant_status: string | null;
      }
    | undefined;

  if (!row || row.is_active === 0) {
    return { session: null, user: null, scope: null, fresh: false };
  }

  const session: Session = {
    id: row.id,
    userId: row.user_id,
    activeTenantId: row.active_tenant_id,
    expiresAt: new Date(row.expires_at * 1000),
  };

  if (Date.now() >= session.expiresAt.getTime()) {
    db.prepare("DELETE FROM session WHERE id = ?").run(session.id);
    return { session: null, user: null, scope: null, fresh: false };
  }

  let fresh = false;
  if (Date.now() >= session.expiresAt.getTime() - 1000 * 60 * 60 * 24 * 15) {
    fresh = true;
    session.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    db.prepare("UPDATE session SET expires_at = ? WHERE id = ?").run(
      Math.floor(session.expiresAt.getTime() / 1000),
      session.id,
    );
  }

  const isPlatformOperator = row.is_platform_operator === 1;

  // Membership and the tenant's own status are re-read on every request, so
  // revoking one or suspending the other takes effect at once.
  let membership: TenantMembership | null = null;
  if (session.activeTenantId) {
    membership = MembershipService.get(session.activeTenantId, row.uid);

    // A suspended tenant is closed to everyone, platform operators included.
    // The pin is dropped, not the session, so the user stays logged in and can
    // select another tenant, as when a membership is revoked.
    const tenantIsOpen = row.tenant_status === "active";
    const stillAMember = membership !== null || isPlatformOperator;

    // A member whose pin is dropped has no tenant scope, so `requireTenantScope`
    // refuses them. For a platform operator no pin is the cross-tenant view, so
    // the reads exclude suspended tenants themselves (`tenantPredicate` in
    // db/query.ts, `canAccessTenant` in auth/scope.ts). POST /api/tenants/active
    // refuses a suspended tenant.
    if (!tenantIsOpen || !stillAMember) {
      setSessionTenant(session.id, null);
      session.activeTenantId = null;
      membership = null;
    }
  }

  const membershipRole: TenantRole | null = membership?.role ?? null;

  const scope: AuthScope = {
    userId: row.uid,
    tenantId: session.activeTenantId,
    membershipRole,
    isPlatformOperator,
  };

  const user: User = {
    id: row.uid,
    username: row.username,
    role: sessionRole({ isPlatformOperator, membershipRole }),
    name: row.uname,
    isPlatformOperator,
    activeTenantId: session.activeTenantId,
    isAvailable: membership?.is_available === 1,
  };

  return { session, user, scope, fresh };
}

export function invalidateSession(sessionId: string): void {
  db.prepare("DELETE FROM session WHERE id = ?").run(sessionId);
}

export function setSessionTokenCookie(
  c: Context,
  token: string,
  expiresAt: Date,
): void {
  setCookie(c, "session", token, {
    httpOnly: true,
    sameSite: "Lax",
    expires: expiresAt,
    path: "/",
    secure: cookieSecure,
  });
}

export function deleteSessionTokenCookie(c: Context): void {
  deleteCookie(c, "session", {
    path: "/",
    secure: cookieSecure,
  });
}

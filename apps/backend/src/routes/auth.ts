import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { db } from "../db/index.ts";
import {
  activeTenantId,
  requireActiveTenant,
  requireAuth,
} from "../middleware/auth.ts";
import { rateLimiter } from "../middleware/security.ts";
import { MembershipService } from "../domains/tenants/index.ts";
import {
  createSession,
  defaultTenantForUser,
  deleteSessionTokenCookie,
  generateSessionToken,
  invalidateSession,
  setSessionTokenCookie,
} from "../platform/auth/session.ts";
import { sessionRole } from "../platform/auth/scope.ts";

/**
 * Logging in and out, and the caller's own account. Mounted at /api/auth ahead
 * of the global `requireAuth`, so each route that needs a session says so.
 */
const auth = new Hono();

auth.post("/login", rateLimiter, async (c) => {
  const { username, password } = await c.req.json();

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as
    | {
        id: string;
        username: string;
        password_hash: string;
        role: string;
        name: string;
        is_active: number;
        is_platform_operator: number;
      }
    | undefined;

  if (!user || user.is_active === 0) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const isPlatformOperator = user.is_platform_operator === 1;

  // A user who belongs to no tenant has nothing to log in to - but a user whose
  // tenants are all suspended does belong to one. Counted with the active-only
  // list, they were told their correct password was wrong. They get the same
  // session `validateSessionToken` leaves a logged-in user with when their
  // tenant is suspended under them: valid, unpinned, and inside the
  // application where they can see they have no business to act in.
  if (!isPlatformOperator && MembershipService.countForUser(user.id) === 0) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // The session carries the tenant scope it acts in; a user in several tenants
  // starts unpinned and picks one via POST /api/tenants/active. Only open
  // tenants can be pinned or picked, so these are the active ones.
  const pinnedTenantId = defaultTenantForUser(user.id, isPlatformOperator);
  const membership = pinnedTenantId
    ? MembershipService.get(pinnedTenantId, user.id)
    : null;

  const token = generateSessionToken();
  const session = createSession(token, user.id, pinnedTenantId);
  setSessionTokenCookie(c, token, session.expiresAt);

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      // The role a caller holds is a property of their membership in the
      // active tenant. Unpinned, they hold none yet - reporting null says so
      // rather than inventing an authority they do not have.
      role: sessionRole({
        isPlatformOperator,
        membershipRole: membership?.role ?? null,
      }),
      name: user.name,
      isPlatformOperator,
      activeTenantId: pinnedTenantId,
      isAvailable: membership?.is_available === 1,
    },
    tenants: MembershipService.listForUser(user.id).map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      role: m.role,
    })),
  });
});

auth.post("/logout", requireAuth, async (c) => {
  const session = c.get("session");
  invalidateSession(session.id);
  deleteSessionTokenCookie(c);
  return c.json({ success: true });
});

auth.get("/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({ user });
});

/**
 * Take yourself in or out of the assignment rotation *of the active tenant*.
 * Availability lives on the membership, so an agent who works for two
 * businesses going offline for one stays in the other's rotation.
 */
auth.patch("/availability", requireAuth, requireActiveTenant, async (c) => {
  const user = c.get("user");
  const tenantId = activeTenantId(c);
  const { isAvailable } = await c.req.json();

  if (typeof isAvailable !== "boolean") {
    return c.json({ error: "isAvailable must be boolean" }, 400);
  }

  if (!MembershipService.setAvailability(tenantId, user.id, isAvailable)) {
    // A platform operator pinned to a tenant they are not a member of has no
    // rotation to be in.
    return c.json({ error: "No membership in the active tenant" }, 404);
  }

  return c.json({ success: true, isAvailable });
});

export default auth;

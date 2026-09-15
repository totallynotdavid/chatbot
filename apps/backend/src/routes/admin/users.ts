import { Hono } from "hono";
import { pathParam } from "../../lib/http.ts";
import { db } from "../../db/index.ts";
import { getAll, getOne } from "../../db/query.ts";
import bcrypt from "bcryptjs";
import { logAction } from "../../platform/audit/logger.ts";
import {
  MembershipService,
  isTenantRole,
} from "../../domains/tenants/index.ts";
import { activeTenantId, requireActiveTenant } from "../../middleware/auth.ts";
import type { TenantRole } from "@totem/types";

const users = new Hono();

type UserRow = {
  id: string;
  username: string;
  name: string;
  is_active: number;
  is_platform_operator: number;
  created_at: number;
};

/**
 * User management is per tenant: an admin sees and edits the members of the
 * tenant they are acting in, and the role returned is the membership role.
 * Platform operators are never listed as members of anything.
 */
users.use("/*", requireActiveTenant);

// List members of the active tenant
users.get("/", (c) => {
  const tenantId = activeTenantId(c);

  const rows = getAll<UserRow & { role: TenantRole }>(
    `SELECT u.id, u.username, u.name, u.is_active, u.is_platform_operator,
            u.created_at, m.role as role
     FROM tenant_memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = ?
     ORDER BY u.created_at`,
    [tenantId],
  );

  return c.json({ users: rows });
});

/**
 * Usernames are one namespace across the whole platform, on purpose: login is
 * `username` + password with no business to pick first, so the name has to
 * identify one account by itself. Somebody who sells for two businesses has one
 * login and two memberships, which is also what makes "go offline for this
 * business only" a membership flag rather than an account one.
 *
 * That means a tenant admin choosing a name necessarily learns whether it is
 * free, and no wording changes that - it is what a unique constraint is. What
 * they must not learn is anything *beyond* availability, so both cases answer
 * with the same sentence. Reporting "username already exists" told a tenant B
 * admin that some account by that name existed somewhere on VendeYa, which is
 * more than the constraint has to give away; saying the name is unavailable and
 * naming the rule gives the admin everything they need to pick another and the
 * prober nothing to distinguish.
 */
const USERNAME_UNAVAILABLE = {
  error:
    "That username is not available. Usernames are shared across every business on VendeYa, so please choose another.",
} as const;

function usernameIsTaken(username: string): boolean {
  return (
    getOne<{ id: string }>("SELECT id FROM users WHERE username = ?", [
      username,
    ]) !== null
  );
}

// Create a user and add them to the active tenant
users.post("/", async (c) => {
  const { username, password, role, name, phoneNumber } = await c.req.json();
  const creator = c.get("user");
  const tenantId = activeTenantId(c);

  if (!username || !password || !role || !name) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  if (!isTenantRole(role)) {
    return c.json({ error: "Invalid role" }, 400);
  }

  if (usernameIsTaken(username)) {
    return c.json(USERNAME_UNAVAILABLE, 409);
  }

  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(password, 10);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, name, phone_number, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, username, hash, role, name, phoneNumber || null, creator.id);

    MembershipService.upsert({
      tenantId,
      userId: id,
      role,
      createdBy: creator.id,
    });
  })();

  logAction({ userId: creator.id, tenantId }, "create_user", "user", id, {
    username,
    role,
    name,
  });

  return c.json({ id, username, role, name });
});

/** Only members of the active tenant may be administered from it. */
function memberOfActiveTenant(tenantId: string, userId: string): boolean {
  return MembershipService.get(tenantId, userId) !== null;
}

/**
 * Whether the caller may change this user's *global* account record - the
 * password hash and the active flag, both of which live on `users` rather than
 * on a membership.
 *
 * Changing either reaches every tenant the account belongs to: a reset password
 * hands over their access elsewhere, and clearing `is_active` locks them out of
 * businesses the acting admin has nothing to do with (setting it again lets
 * them back in). So a tenant admin may only touch the global record of a user
 * whose sole membership is the tenant being acted in; beyond that it takes a
 * platform operator, who already has cross-tenant authority.
 *
 * The tenant-scoped alternative is to revoke the membership, which removes the
 * user from this tenant and leaves their other ones alone.
 */
function mayEditGlobalAccount(
  scope: { isPlatformOperator: boolean },
  userId: string,
): boolean {
  return (
    scope.isPlatformOperator || MembershipService.countForUser(userId) <= 1
  );
}

const CROSS_TENANT_ACCOUNT_ERROR = {
  error:
    "This user belongs to other businesses too, so their account cannot be changed from here; remove their access to this business instead, or ask VendeYa staff",
} as const;

/**
 * Toggle user active status.
 *
 * `is_active` is on the global user record, so this is gated the same way as a
 * password reset - see mayEditGlobalAccount.
 */
users.patch("/:id/status", (c) => {
  const userId = pathParam(c, "id");
  const admin = c.get("user");
  const scope = c.get("scope");
  const tenantId = activeTenantId(c);

  if (!memberOfActiveTenant(tenantId, userId)) {
    return c.json({ error: "User not found" }, 404);
  }

  if (!mayEditGlobalAccount(scope, userId)) {
    return c.json(CROSS_TENANT_ACCOUNT_ERROR, 403);
  }

  const user = getOne<{ is_active: number }>(
    "SELECT is_active FROM users WHERE id = ?",
    [userId],
  );

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const newStatus = user.is_active === 1 ? 0 : 1;

  db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(
    newStatus,
    userId,
  );

  // Invalidate all sessions if deactivating
  if (newStatus === 0) {
    db.prepare("DELETE FROM session WHERE user_id = ?").run(userId);
  }

  logAction(
    { userId: admin.id, tenantId },
    "toggle_user_status",
    "user",
    userId,
    {
      newStatus: newStatus === 1 ? "active" : "inactive",
      byPlatformOperator: scope.isPlatformOperator,
    },
  );

  return c.json({ success: true, is_active: newStatus });
});

/**
 * Force password change.
 *
 * `password_hash` is on the global user record, so this is gated the same way
 * as the active flag - see mayEditGlobalAccount.
 */
users.post("/:id/password", async (c) => {
  const userId = pathParam(c, "id");
  const { newPassword } = await c.req.json();
  const admin = c.get("user");
  const scope = c.get("scope");
  const tenantId = activeTenantId(c);

  if (!memberOfActiveTenant(tenantId, userId)) {
    return c.json({ error: "User not found" }, 404);
  }

  if (!mayEditGlobalAccount(scope, userId)) {
    return c.json(CROSS_TENANT_ACCOUNT_ERROR, 403);
  }

  if (!newPassword || newPassword.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400);
  }

  const hash = bcrypt.hashSync(newPassword, 10);

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hash,
    userId,
  );

  // Invalidate all sessions
  db.prepare("DELETE FROM session WHERE user_id = ?").run(userId);

  logAction({ userId: admin.id, tenantId }, "reset_password", "user", userId, {
    byPlatformOperator: scope.isPlatformOperator,
  });

  return c.json({ success: true });
});

// Update a member's role inside the active tenant
users.patch("/:id/role", async (c) => {
  const userId = pathParam(c, "id");
  const { role } = await c.req.json();
  const admin = c.get("user");
  const tenantId = activeTenantId(c);

  if (!isTenantRole(role)) {
    return c.json({ error: "Invalid role" }, 400);
  }

  const membership = MembershipService.get(tenantId, userId);
  if (!membership) {
    return c.json({ error: "User not found" }, 404);
  }

  const oldRole = membership.role;

  MembershipService.upsert({
    tenantId,
    userId,
    role,
    createdBy: admin.id,
  });

  // Invalidate sessions so the user picks up the new role on next request
  db.prepare("DELETE FROM session WHERE user_id = ?").run(userId);

  logAction(
    { userId: admin.id, tenantId },
    "update_user_role",
    "user",
    userId,
    {
      oldRole,
      newRole: role,
    },
  );

  return c.json({ success: true, role });
});

// Remove a user from the active tenant (the account itself is untouched)
users.delete("/:id/membership", (c) => {
  const userId = pathParam(c, "id");
  const admin = c.get("user");
  const tenantId = activeTenantId(c);

  if (!memberOfActiveTenant(tenantId, userId)) {
    return c.json({ error: "User not found" }, 404);
  }

  MembershipService.remove(tenantId, userId);
  db.prepare(
    "UPDATE session SET active_tenant_id = NULL WHERE user_id = ? AND active_tenant_id = ?",
  ).run(userId, tenantId);

  logAction(
    { userId: admin.id, tenantId },
    "remove_membership",
    "user",
    userId,
  );

  return c.json({ success: true });
});

export default users;

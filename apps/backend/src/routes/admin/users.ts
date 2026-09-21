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
import { MIN_PASSWORD_LENGTH, type TenantRole } from "@vendeya/types";

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
 * User management is per tenant. An admin sees and edits the members of the
 * tenant they are acting in, and the role returned is the membership role.
 * A platform operator appears only if they hold a membership there, as a
 * promoted member account does.
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
 * Usernames are one namespace across the platform, because login takes a
 * username and password with no business to pick first. A tenant admin
 * necessarily learns whether a name is free. The answer must not say more, so a
 * name held by another business gets the same sentence as one held here.
 */
const USERNAME_UNAVAILABLE = {
  error:
    "That username is not available. Usernames are shared across every business on VendeYa, so please choose another.",
} as const;

const PASSWORD_TOO_SHORT = {
  error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
} as const;

function meetsPasswordMinimum(password: unknown): password is string {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

function usernameIsTaken(username: string): boolean {
  return (
    getOne<{ id: string }>("SELECT id FROM users WHERE username = ?", [
      username,
    ]) !== undefined
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

  if (!meetsPasswordMinimum(password)) {
    return c.json(PASSWORD_TOO_SHORT, 400);
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

function memberOfActiveTenant(tenantId: string, userId: string): boolean {
  return MembershipService.get(tenantId, userId) !== null;
}

function isPlatformOperator(userId: string): boolean {
  return (
    getOne<{ is_platform_operator: number }>(
      "SELECT is_platform_operator FROM users WHERE id = ?",
      [userId],
    )?.is_platform_operator === 1
  );
}

/**
 * Why the caller may not change this user's password hash or active flag, or
 * null. Both reach every tenant the account belongs to, so a tenant admin may
 * change them only for a user whose sole membership is the acting tenant, and
 * never for a platform operator, whose account reaches every tenant whatever
 * memberships it kept. Anything else needs a platform operator.
 */
function globalAccountRefusal(
  scope: { isPlatformOperator: boolean },
  userId: string,
): { error: string } | null {
  if (scope.isPlatformOperator) return null;
  if (isPlatformOperator(userId)) return PLATFORM_OPERATOR_ACCOUNT_ERROR;
  if (MembershipService.countForUser(userId) > 1) {
    return CROSS_TENANT_ACCOUNT_ERROR;
  }
  return null;
}

const CROSS_TENANT_ACCOUNT_ERROR = {
  error:
    "This user belongs to other businesses too, so their account cannot be changed from here; remove their access to this business instead, or ask VendeYa staff",
} as const;

const PLATFORM_OPERATOR_ACCOUNT_ERROR = {
  error:
    "This user is VendeYa staff, so their account can only be changed by VendeYa staff",
} as const;

/**
 * `is_active` is on the global user record, so this route is gated by
 * `globalAccountRefusal`, like a password reset.
 */
users.patch("/:id/status", (c) => {
  const userId = pathParam(c, "id");
  const admin = c.get("user");
  const scope = c.get("scope");
  const tenantId = activeTenantId(c);

  if (!memberOfActiveTenant(tenantId, userId)) {
    return c.json({ error: "User not found" }, 404);
  }

  const refusal = globalAccountRefusal(scope, userId);
  if (refusal) {
    return c.json(refusal, 403);
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
 * `password_hash` is on the global user record, so this route is gated by
 * `globalAccountRefusal`, like the active flag.
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

  const refusal = globalAccountRefusal(scope, userId);
  if (refusal) {
    return c.json(refusal, 403);
  }

  if (!meetsPasswordMinimum(newPassword)) {
    return c.json(PASSWORD_TOO_SHORT, 400);
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

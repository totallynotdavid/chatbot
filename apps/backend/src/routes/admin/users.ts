import { Hono } from "hono";
import { db } from "../../db/index.ts";
import bcrypt from "bcryptjs";
import { logAction } from "../../platform/audit/logger.ts";
import type { User } from "@totem/types";

const users = new Hono();

// List all users
users.get("/", (c) => {
  const allUsers = db
    .prepare(
      "SELECT id, username, role, name, is_active, created_at FROM users",
    )
    .all() as Omit<User, "password_hash">[];

  return c.json({ users: allUsers });
});

// Create user
users.post("/", async (c) => {
  const { username, password, role, name, phoneNumber } = await c.req.json();
  const creator = c.get("user");

  if (!username || !password || !role || !name) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  if (!["admin", "developer", "supervisor", "sales_agent"].includes(role)) {
    return c.json({ error: "Invalid role" }, 400);
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username);

  if (existing) {
    return c.json({ error: "Username already exists" }, 409);
  }

  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(password, 10);

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, name, phone_number, created_by) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, username, hash, role, name, phoneNumber || null, creator.id);

  logAction(creator.id, "create_user", "user", id, {
    username,
    role,
    name,
  });

  return c.json({ id, username, role, name });
});

// Toggle user active status
users.patch("/:id/status", (c) => {
  const userId = c.req.param("id");
  const admin = c.get("user");

  const user = db
    .prepare("SELECT is_active FROM users WHERE id = ?")
    .get(userId) as { is_active: number } | undefined;

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

  logAction(admin.id, "toggle_user_status", "user", userId, {
    newStatus: newStatus === 1 ? "active" : "inactive",
  });

  return c.json({ success: true, is_active: newStatus });
});

// Force password change
users.post("/:id/password", async (c) => {
  const userId = c.req.param("id");
  const { newPassword } = await c.req.json();
  const admin = c.get("user");

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

  logAction(admin.id, "reset_password", "user", userId);

  return c.json({ success: true });
});

// Update user role
users.patch("/:id/role", async (c) => {
  const userId = c.req.param("id");
  const { role } = await c.req.json();
  const admin = c.get("user");

  if (!["admin", "developer", "supervisor", "sales_agent"].includes(role)) {
    return c.json({ error: "Invalid role" }, 400);
  }

  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined;

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const oldRole = user.role;

  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);

  // Invalidate sessions so user gets new permissions on next request
  db.prepare("DELETE FROM session WHERE user_id = ?").run(userId);

  logAction(admin.id, "update_user_role", "user", userId, {
    oldRole,
    newRole: role,
  });

  return c.json({ success: true, role });
});

export default users;

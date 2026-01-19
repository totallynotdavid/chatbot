import { Hono } from "hono";
import { db } from "../db/index.ts";
import bcrypt from "bcryptjs";
import { logAction, getAuditTrail } from "../platform/audit/logger.ts";
import {
  processHeldMessages,
  countHeldMessages,
} from "../conversation/index.ts";
import {
  retryStuckEligibilityChecks,
  countWaitingForRecovery,
} from "../domains/conversations/recovery.ts";
import type { User } from "@totem/types";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("admin");

const admin = new Hono();

// List all users
admin.get("/users", (c) => {
  const users = db
    .prepare(
      "SELECT id, username, role, name, is_active, created_at FROM users",
    )
    .all() as Omit<User, "password_hash">[];

  return c.json({ users });
});

// Create user
admin.post("/users", async (c) => {
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

  return c.json({
    id,
    username,
    role,
    name,
  });
});

// Toggle user active status
admin.patch("/users/:id/status", (c) => {
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
admin.post("/users/:id/password", async (c) => {
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
admin.patch("/users/:id/role", async (c) => {
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

// Get LLM errors
admin.get("/llm-errors", (c) => {
  const phoneFilter = c.req.query("phone");
  const operationFilter = c.req.query("operation");
  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 100;

  let query = "SELECT * FROM llm_errors";
  const params: string[] = [];
  const conditions: string[] = [];

  if (phoneFilter) {
    conditions.push("phone_number = ?");
    params.push(phoneFilter);
  }

  if (operationFilter) {
    conditions.push("operation = ?");
    params.push(operationFilter);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(String(limit));

  const errors = db.prepare(query).all(...params) as {
    id: string;
    phone_number: string;
    operation: string;
    error_type: string;
    state: string | null;
    metadata: string | null;
    created_at: number;
  }[];

  return c.json({
    errors: errors.map((e) => ({
      ...e,
      metadata: e.metadata ? JSON.parse(e.metadata) : null,
    })),
  });
});

// Get audit trail
admin.get("/audit", (c) => {
  const userIdFilter = c.req.query("user_id");
  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 100;

  const logs = getAuditTrail(userIdFilter, limit);

  // Resolve user names
  const userIds = [...new Set(logs.map((l) => l.user_id))];
  const users = db
    .prepare(
      `SELECT id, username, name FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
    )
    .all(...userIds) as { id: string; username: string; name: string }[];

  const userMap = new Map(users.map((u) => [u.id, u]));

  const logsWithNames = logs.map((log) => ({
    ...log,
    user_name: userMap.get(log.user_id)?.name || "Usuario eliminado",
    user_username: userMap.get(log.user_id)?.username || log.user_id,
  }));

  return c.json({ logs: logsWithNames });
});

// Get system settings
admin.get("/settings", (c) => {
  const settings = db.prepare("SELECT * FROM system_settings").all() as {
    key: string;
    value: string;
    updated_at: number;
  }[];

  const formatted = settings.reduce(
    (acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    },
    {} as Record<string, string>,
  );

  return c.json(formatted);
});

// Update system settings
admin.post("/settings", async (c) => {
  const user = c.get("user");
  const settings = await c.req.json();
  const timestamp = Date.now();

  const insert = db.prepare(
    "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)",
  );

  const updates: Record<string, string> = {};

  db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      insert.run(key, String(value), timestamp);
      updates[key] = String(value);
    }
  })();

  logAction(user.id, "update_settings", "system", null, updates);

  return c.json({ success: true, updates });
});

// Process held messages from maintenance mode
admin.post("/process-held-messages", async (c) => {
  const user = c.get("user");
  const pendingCount = countHeldMessages();

  if (pendingCount === 0) {
    return c.json({
      success: true,
      message: "No held messages to process",
      stats: { usersProcessed: 0, messagesProcessed: 0, errors: 0 },
    });
  }

  logger.info(
    { username: user.username, pendingCount },
    "Admin triggered held messages processing",
  );

  const result = await processHeldMessages();

  logAction(user.id, "process_held_messages", "system", null, result);

  const userWord = result.usersProcessed === 1 ? "usuario" : "usuarios";
  const messageWord = result.messagesProcessed === 1 ? "mensaje" : "mensajes";

  return c.json({
    success: true,
    message: `Procesados ${result.messagesProcessed} ${messageWord} de ${result.usersProcessed} ${userWord}`,
    stats: result,
  });
});

// Get held messages status
admin.get("/held-messages-status", (c) => {
  const count = countHeldMessages();
  return c.json({ pendingCount: count });
});

// Get system outage status
admin.get("/outage-status", (c) => {
  const waitingCount = countWaitingForRecovery();
  return c.json({ waitingCount });
});

// Retry eligibility for waiting users
admin.post("/retry-eligibility", async (c) => {
  const user = c.get("user");

  const result = await retryStuckEligibilityChecks();

  logAction(user.id, "retry_eligibility", "system", null, result);

  return c.json({
    success: true,
    message: `Recuperados ${result.recoveredCount}, fallando ${result.stillFailingCount}, errores ${result.errors}`,
    stats: result,
  });
});

export default admin;

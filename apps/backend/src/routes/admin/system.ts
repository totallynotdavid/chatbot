import { Hono } from "hono";
import { db } from "../../db/index.ts";
import { logAction, getAuditTrail } from "../../platform/audit/logger.ts";

const system = new Hono();

system.get("/llm-errors", (c) => {
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

system.get("/audit", (c) => {
  const userIdFilter = c.req.query("user_id");
  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 100;

  const logs = getAuditTrail(userIdFilter, limit);

  // Resolve user names
  const userIds = [...new Set(logs.map((l) => l.user_id))];
  const dbUsers = db
    .prepare(
      `SELECT id, username, name FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
    )
    .all(...userIds) as { id: string; username: string; name: string }[];

  const userMap = new Map(dbUsers.map((u) => [u.id, u]));

  const logsWithNames = logs.map((log) => ({
    ...log,
    user_name: userMap.get(log.user_id)?.name || "Usuario eliminado",
    user_username: userMap.get(log.user_id)?.username || log.user_id,
  }));

  return c.json({ logs: logsWithNames });
});

system.get("/settings", (c) => {
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

system.post("/settings", async (c) => {
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

export default system;

import { Hono } from "hono";
import { db } from "../db/index.ts";
import { WhatsAppService } from "../services/whatsapp.ts";
import { getEventsByPhone } from "../services/analytics.ts";
import { logAction } from "../services/audit.ts";
import { buildStateContext } from "../agent/context.ts";
import type { Conversation, ReplayData, ReplayMetadata } from "@totem/types";

const conversations = new Hono();

// List all conversations
conversations.get("/", (c) => {
  const status = c.req.query("status");
  let query =
    "SELECT * FROM conversations WHERE is_simulation = 0 ORDER BY last_activity_at DESC LIMIT 100";
  let params: any[] = [];

  if (status) {
    query =
      "SELECT * FROM conversations WHERE is_simulation = 0 AND status = ? ORDER BY last_activity_at DESC LIMIT 100";
    params = [status];
  }

  const rows = db.prepare(query).all(...params) as Conversation[];
  return c.json(rows);
});

// Get conversation detail with messages
conversations.get("/:phone", (c) => {
  const phoneNumber = c.req.param("phone");

  const conv = db
    .prepare("SELECT * FROM conversations WHERE phone_number = ?")
    .get(phoneNumber) as Conversation | undefined;

  if (!conv) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  const messages = WhatsAppService.getMessageHistory(phoneNumber, 100);
  const events = getEventsByPhone(phoneNumber);

  return c.json({
    conversation: conv,
    messages: messages.reverse(),
    events,
  });
});

// Manual takeover
conversations.post("/:phone/takeover", (c) => {
  const phoneNumber = c.req.param("phone");
  const user = c.get("user");

  db.prepare(
    `UPDATE conversations
     SET status = 'human_takeover',
       handover_reason = 'Manual takeover by agent',
       last_activity_at = CURRENT_TIMESTAMP
     WHERE phone_number = ?`,
  ).run(phoneNumber);

  logAction(user.id, "takeover", "conversation", phoneNumber, {
    agent: user.username,
  });

  return c.json({ success: true });
});

// Send manual message
conversations.post("/:phone/message", async (c) => {
  const phoneNumber = c.req.param("phone");
  const { content } = await c.req.json();
  const user = c.get("user");

  if (!content) {
    return c.json({ error: "content required" }, 400);
  }

  await WhatsAppService.sendMessage(phoneNumber, content);

  logAction(user.id, "send_message", "conversation", phoneNumber, {
    message: content,
  });

  return c.json({ success: true });
});

// Release conversation back to bot
conversations.post("/:phone/release", (c) => {
  const phoneNumber = c.req.param("phone");
  const user = c.get("user");

  db.prepare(
    `UPDATE conversations
     SET status = 'active',
       handover_reason = NULL
     WHERE phone_number = ?`,
  ).run(phoneNumber);

  logAction(user.id, "release", "conversation", phoneNumber);

  return c.json({ success: true });
});

// Update agent data (notes, sale status, delivery info)
conversations.patch("/:phone/agent-data", async (c) => {
  const phoneNumber = c.req.param("phone");
  const user = c.get("user");
  const updates = await c.req.json();

  const allowedFields = [
    "agent_notes",
    "sale_status",
    "delivery_address",
    "delivery_reference",
    "products_interested",
  ];

  const validUpdates: Record<string, any> = {};
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      validUpdates[field] = updates[field];
    }
  }

  // Validate sale_status
  if (
    validUpdates.sale_status &&
    !["pending", "confirmed", "rejected", "no_answer"].includes(
      validUpdates.sale_status,
    )
  ) {
    return c.json({ error: "Invalid sale_status" }, 400);
  }

  // Auto-assign agent if not already assigned
  const conv = db
    .prepare("SELECT assigned_agent FROM conversations WHERE phone_number = ?")
    .get(phoneNumber) as { assigned_agent: string | null } | undefined;

  if (conv && !conv.assigned_agent) {
    validUpdates.assigned_agent = user.id;
  }

  if (Object.keys(validUpdates).length === 0) {
    return c.json({ success: true });
  }

  const fields = Object.keys(validUpdates)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(validUpdates);

  db.prepare(`UPDATE conversations SET ${fields} WHERE phone_number = ?`).run(
    ...values,
    phoneNumber,
  );

  logAction(
    user.id,
    "update_agent_data",
    "conversation",
    phoneNumber,
    validUpdates,
  );

  return c.json({ success: true });
});

// Get conversation replay data (for debugging in simulator)
conversations.get("/:phone/replay", (c) => {
  const phoneNumber = c.req.param("phone");
  const user = c.get("user");

  // Only admins and developers can replay conversations
  if (user.role !== "admin" && user.role !== "developer") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const conv = db
    .prepare("SELECT * FROM conversations WHERE phone_number = ?")
    .get(phoneNumber) as Conversation | undefined;

  if (!conv) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  const messages = WhatsAppService.getMessageHistory(phoneNumber, 1000);
  const initialContext = buildStateContext(conv);

  const metadata: ReplayMetadata = {
    conversationId: phoneNumber,
    clientName: conv.client_name,
    segment: conv.segment,
    creditLine: conv.credit_line,
    finalState: conv.current_state,
    messageCount: messages.length,
    timestamp: new Date().toISOString(),
  };

  const replayData: ReplayData = {
    conversation: conv,
    messages: messages.reverse(), // chronological order
    initialContext,
    metadata,
  };

  logAction(user.id, "export_replay", "conversation", phoneNumber);

  return c.json(replayData);
});

export default conversations;

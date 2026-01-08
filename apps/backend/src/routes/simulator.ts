import { Hono } from "hono";
import { processMessagePipeline } from "../modules/chat/pipeline.ts";
import { executeCommand } from "../modules/chat/dispatcher.ts";
import { WhatsAppService } from "../services/whatsapp/index.ts";
import { PersonasService } from "../services/personas.ts";
import {
  getOrCreateConversation,
  resetSession,
  updateConversationState,
  buildStateContext,
} from "../modules/chat/context.ts";
import { db } from "../db/index.ts";
import { requireRole } from "../middleware/auth.ts";
import type { Conversation } from "@totem/types";

const simulator = new Hono();

simulator.use("/*", requireRole("admin", "developer"));

// Get available test personas
simulator.get("/personas", (c) => {
  const personas = PersonasService.getAll();
  return c.json(personas);
});

// Create new test persona
simulator.post("/personas", async (c) => {
  const user = c.get("user");

  const { id, name, description, segment, clientName, dni, creditLine, nse } =
    await c.req.json();

  if (
    !id ||
    !name ||
    !description ||
    !segment ||
    !clientName ||
    !dni ||
    creditLine === undefined
  ) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  try {
    const persona = PersonasService.create(
      {
        id,
        name,
        description,
        segment,
        clientName,
        dni,
        creditLine,
        nse,
      },
      user.id,
    );
    return c.json(persona);
  } catch (error) {
    console.error("Failed to create persona:", error);
    return c.json({ error: "Failed to create persona" }, 500);
  }
});

// Update test persona
simulator.patch("/personas/:id", async (c) => {
  const personaId = c.req.param("id");
  const updates = await c.req.json();

  try {
    PersonasService.update(personaId, updates);
    const updated = PersonasService.getById(personaId);
    return c.json(updated);
  } catch (error) {
    console.error("Failed to update persona:", error);
    return c.json({ error: "Failed to update persona" }, 500);
  }
});

// Delete test persona
simulator.delete("/personas/:id", (c) => {
  const personaId = c.req.param("id");

  try {
    PersonasService.delete(personaId);
    return c.json({ status: "deleted" });
  } catch (error) {
    console.error("Failed to delete persona:", error);
    return c.json({ error: "Failed to delete persona" }, 500);
  }
});

// List all test conversations
simulator.get("/conversations", (c) => {
  const conversations = db
    .prepare(
      `SELECT * FROM conversations 
       WHERE is_simulation = 1 
       ORDER BY last_activity_at DESC`,
    )
    .all() as Conversation[];

  return c.json(conversations);
});

// Create new test conversation
simulator.post("/conversations", async (c) => {
  const { phoneNumber, personaId } = await c.req.json();

  if (!phoneNumber) {
    return c.json({ error: "phoneNumber required" }, 400);
  }

  // Validate persona if provided
  if (personaId) {
    const persona = PersonasService.getById(personaId);
    if (!persona) {
      return c.json({ error: "Invalid persona_id" }, 400);
    }
  }

  // Check if already exists
  const existing = db
    .prepare("SELECT * FROM conversations WHERE phone_number = ?")
    .get(phoneNumber) as Conversation | undefined;

  if (existing) {
    return c.json({ error: "Conversation already exists" }, 400);
  }

  // Create new test conversation with persona
  db.prepare(
    "INSERT INTO conversations (phone_number, current_state, status, is_simulation, persona_id) VALUES (?, ?, ?, ?, ?)",
  ).run(phoneNumber, "INIT", "active", 1, personaId || null);

  const conv = db
    .prepare("SELECT * FROM conversations WHERE phone_number = ?")
    .get(phoneNumber) as Conversation;

  return c.json(conv);
});

// Send message in simulator
simulator.post("/message", async (c) => {
  const { phoneNumber, message } = await c.req.json();

  if (!phoneNumber || !message) {
    return c.json({ error: "phoneNumber and message required" }, 400);
  }

  getOrCreateConversation(phoneNumber, true);

  WhatsAppService.logMessage(
    phoneNumber,
    "inbound",
    "text",
    message,
    "received",
  );

  // Process message through pipeline (synchronous for simulator)
  const output = await processMessagePipeline(phoneNumber, message);

  // Execute commands synchronously for immediate response
  const conv = db
    .prepare("SELECT * FROM conversations WHERE phone_number = ?")
    .get(phoneNumber) as Conversation;
  const context = buildStateContext(conv);

  for (const command of output.commands) {
    await executeCommand(conv, command, context);
  }

  return c.json({ status: "processed" });
});

// Get conversation state for simulator
simulator.get("/conversation/:phone", (c) => {
  const phoneNumber = c.req.param("phone");
  const conv = getOrCreateConversation(phoneNumber, true);
  const messages = WhatsAppService.getMessageHistory(phoneNumber, 100);

  return c.json({
    conversation: conv,
    messages: messages.reverse(), // chronological order
  });
});

// Reset simulator conversation
simulator.post("/reset/:phone", (c) => {
  const phoneNumber = c.req.param("phone");
  resetSession(phoneNumber);
  WhatsAppService.clearMessageHistory(phoneNumber);

  return c.json({ status: "reset" });
});

// Delete simulator conversation
simulator.delete("/conversations/:phone", (c) => {
  const phoneNumber = c.req.param("phone");

  // Verify it's a simulation conversation before deleting
  const conv = db
    .prepare("SELECT is_simulation FROM conversations WHERE phone_number = ?")
    .get(phoneNumber) as { is_simulation: number } | undefined;

  if (!conv) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  if (conv.is_simulation !== 1) {
    return c.json({ error: "Can only delete simulation conversations" }, 403);
  }

  // Delete conversation from database
  db.prepare("DELETE FROM conversations WHERE phone_number = ?").run(
    phoneNumber,
  );

  // Clear message history
  WhatsAppService.clearMessageHistory(phoneNumber);

  return c.json({ status: "deleted" });
});

// Load conversation into simulator (for replay/debugging)
simulator.post("/load", async (c) => {
  const { sourcePhone } = await c.req.json();

  if (!sourcePhone) {
    return c.json({ error: "sourcePhone required" }, 400);
  }

  // Fetch source conversation
  const sourceConv = db
    .prepare("SELECT * FROM conversations WHERE phone_number = ?")
    .get(sourcePhone) as Conversation | undefined;

  if (!sourceConv) {
    return c.json({ error: "Source conversation not found" }, 404);
  }

  const sourceMessages = WhatsAppService.getMessageHistory(sourcePhone, 1000);

  // Use fixed simulator phone
  const simulatorPhone = "51999999999";

  // Reset simulator first
  resetSession(simulatorPhone);
  WhatsAppService.clearMessageHistory(simulatorPhone);

  // Create/update simulator conversation with source data
  getOrCreateConversation(simulatorPhone, true);

  // Copy context data and state
  updateConversationState(simulatorPhone, sourceConv.current_state, {
    ...JSON.parse(sourceConv.context_data || "{}"),
  });

  // Update additional fields directly
  db.prepare(
    `UPDATE conversations 
     SET client_name = ?,
       dni = ?,
       segment = ?,
       credit_line = ?,
       nse = ?,
       is_calidda_client = ?
     WHERE phone_number = ?`,
  ).run(
    sourceConv.client_name,
    sourceConv.dni,
    sourceConv.segment,
    sourceConv.credit_line,
    sourceConv.nse,
    sourceConv.is_calidda_client,
    simulatorPhone,
  );

  // Copy messages in chronological order
  for (const msg of sourceMessages.reverse()) {
    WhatsAppService.logMessage(
      simulatorPhone,
      msg.direction,
      msg.type,
      msg.content,
      msg.status,
    );
  }

  return c.json({
    status: "loaded",
    simulatorPhone,
    messageCount: sourceMessages.length,
  });
});

export default simulator;

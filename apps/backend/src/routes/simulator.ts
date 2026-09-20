import { Hono } from "hono";
import { pathParam } from "../lib/http.ts";
import type { Context } from "hono";
import { WhatsAppService } from "../adapters/whatsapp/index.ts";
import { PersonasService } from "../domains/personas/index.ts";
import { ChannelAccountService } from "../domains/channels/accounts.ts";
import {
  getOrCreateConversation,
  resetSession,
  handleMessage,
} from "../conversation/index.ts";
import { findConversation } from "../conversation/store.ts";
import { db } from "../db/index.ts";
import { getAll } from "../db/query.ts";
import {
  activeTenantId,
  requireActiveTenant,
  requireRole,
} from "../middleware/auth.ts";
import type { Conversation, ConversationRef } from "@totem/types";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("simulator");

const simulator = new Hono();

// The simulator writes conversations, so it always needs a concrete tenant.
simulator.use("/*", requireActiveTenant);
simulator.use("/*", requireRole("admin", "developer"));

/**
 * Simulated conversations still belong to a channel account: they are stored in
 * the same table and share its identity. The tenant's default account is used.
 */
function simulatorRef(c: Context, phoneNumber: string): ConversationRef | null {
  const tenantId = activeTenantId(c);
  const account = ChannelAccountService.getDefaultForTenant(tenantId);

  if (!account) return null;

  return {
    tenantId,
    channelAccountId: account.id,
    phoneNumber,
  };
}

/**
 * The conversation being replayed belongs to the tenant but not necessarily to
 * the number the simulator runs on. A business with two WhatsApp numbers has
 * two separate threads with the same contact, and `channelAccountId` says which
 * one is being loaded. Without it the default account is assumed.
 */
function replaySourceRef(
  c: Context,
  phoneNumber: string,
  channelAccountId?: string,
): ConversationRef | null {
  if (!channelAccountId) return simulatorRef(c, phoneNumber);

  const tenantId = activeTenantId(c);
  const account = ChannelAccountService.getById(channelAccountId);

  // Another tenant's account is indistinguishable from one that does not exist.
  if (!account || account.tenant_id !== tenantId) return null;

  return { tenantId, channelAccountId, phoneNumber };
}

const NO_ACCOUNT = {
  error:
    "This tenant has no channel account yet; add one before using the simulator",
} as const;

/** Every replay is loaded onto this contact, on the tenant's default number. */
const SIMULATOR_PHONE = "51999999999";

// Get available test personas
simulator.get("/personas", (c) => {
  return c.json(PersonasService.getAll(activeTenantId(c)));
});

// Create new test persona
simulator.post("/personas", async (c) => {
  const user = c.get("user");
  const tenantId = activeTenantId(c);

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
      tenantId,
      { id, name, description, segment, clientName, dni, creditLine, nse },
      user.id,
    );
    return c.json(persona);
  } catch (error) {
    logger.error({ error, user: user.id, tenantId }, "Persona creation failed");
    return c.json({ error: "Failed to create persona" }, 500);
  }
});

// Update test persona
simulator.patch("/personas/:id", async (c) => {
  const personaId = pathParam(c, "id");
  const tenantId = activeTenantId(c);
  const updates = await c.req.json();

  try {
    PersonasService.update(tenantId, personaId, updates);
    const updated = PersonasService.getById(tenantId, personaId);
    return c.json(updated);
  } catch (error) {
    logger.error({ error, personaId, tenantId }, "Persona update failed");
    return c.json({ error: "Failed to update persona" }, 500);
  }
});

// Delete test persona
simulator.delete("/personas/:id", (c) => {
  const personaId = pathParam(c, "id");
  const tenantId = activeTenantId(c);

  try {
    PersonasService.delete(tenantId, personaId);
    return c.json({ status: "deleted" });
  } catch (error) {
    logger.error({ error, personaId, tenantId }, "Persona deletion failed");
    return c.json({ error: "Failed to delete persona" }, 500);
  }
});

/**
 * The simulated conversations on the simulator's number. Every route here that
 * takes a simulated conversation's phone number resolves it through
 * `simulatorRef`, and the frontend keys rows by phone number alone. A row on
 * another number would open a new empty thread or answer 404.
 */
simulator.get("/conversations", (c) => {
  const ref = simulatorRef(c, SIMULATOR_PHONE);
  if (!ref) return c.json(NO_ACCOUNT, 400);

  // Simulations on another number stay in the table. They show again if that
  // number becomes the default.
  const conversations = getAll<Conversation>(
    `SELECT * FROM conversations
     WHERE tenant_id = ? AND channel_account_id = ? AND is_simulation = 1
     ORDER BY last_activity_at DESC`,
    [ref.tenantId, ref.channelAccountId],
  );

  return c.json(conversations);
});

// Create new test conversation
simulator.post("/conversations", async (c) => {
  const tenantId = activeTenantId(c);
  const { phoneNumber, personaId } = await c.req.json();

  if (!phoneNumber) {
    return c.json({ error: "phoneNumber required" }, 400);
  }

  const ref = simulatorRef(c, phoneNumber);
  if (!ref) return c.json(NO_ACCOUNT, 400);

  // Validate persona if provided
  if (personaId) {
    const persona = PersonasService.getById(tenantId, personaId);
    if (!persona) {
      return c.json({ error: "Invalid persona_id" }, 400);
    }
  }

  // Check if already exists
  if (findConversation(ref)) {
    return c.json({ error: "Conversation already exists" }, 400);
  }

  // Create new test conversation with persona
  const initialPhase = { phase: "greeting" };
  const initialMetadata = { createdAt: Date.now(), lastActivityAt: Date.now() };

  db.prepare(
    `INSERT INTO conversations (tenant_id, channel_account_id, phone_number, context_data, status, is_simulation, persona_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ref.tenantId,
    ref.channelAccountId,
    ref.phoneNumber,
    JSON.stringify({ phase: initialPhase, metadata: initialMetadata }),
    "active",
    1,
    personaId || null,
  );

  return c.json(findConversation(ref)!);
});

// Send message in simulator
simulator.post("/message", async (c) => {
  const { phoneNumber, message } = await c.req.json();

  if (!phoneNumber || !message) {
    return c.json({ error: "phoneNumber and message required" }, 400);
  }

  const ref = simulatorRef(c, phoneNumber);
  if (!ref) return c.json(NO_ACCOUNT, 400);

  getOrCreateConversation(ref, true);

  WhatsAppService.logMessage(ref, "inbound", "text", message, "received");

  // Process message through new handler (synchronous for simulator)
  await handleMessage({
    ref,
    content: message,
    timestamp: Date.now(),
    messageId: `sim-${Date.now()}`,
  });

  return c.json({ status: "processed" });
});

// Get conversation state for simulator
simulator.get("/conversation/:phone", (c) => {
  const ref = simulatorRef(c, pathParam(c, "phone"));
  if (!ref) return c.json(NO_ACCOUNT, 400);

  const conv = getOrCreateConversation(ref, true);
  const messages = WhatsAppService.getMessageHistory(ref, 100);

  return c.json({
    conversation: conv,
    messages: messages.reverse(), // chronological order
  });
});

// Reset simulator conversation
simulator.post("/reset/:phone", (c) => {
  const ref = simulatorRef(c, pathParam(c, "phone"));
  if (!ref) return c.json(NO_ACCOUNT, 400);

  resetSession(ref);
  WhatsAppService.clearMessageHistory(ref);

  return c.json({ status: "reset" });
});

// Delete simulator conversation
simulator.delete("/conversations/:phone", (c) => {
  const ref = simulatorRef(c, pathParam(c, "phone"));
  if (!ref) return c.json(NO_ACCOUNT, 400);

  const conv = findConversation(ref);

  if (!conv) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  if (conv.is_simulation !== 1) {
    return c.json({ error: "Can only delete simulation conversations" }, 403);
  }

  db.prepare(
    `DELETE FROM conversations
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
  ).run(ref.tenantId, ref.channelAccountId, ref.phoneNumber);

  WhatsAppService.clearMessageHistory(ref);

  return c.json({ status: "deleted" });
});

// Load conversation into simulator (for replay/debugging)
simulator.post("/load", async (c) => {
  const { sourcePhone, sourceChannel } = await c.req.json();

  if (!sourcePhone) {
    return c.json({ error: "sourcePhone required" }, 400);
  }

  // The replay always loads onto the default account, where the rest of the
  // simulator looks for it. Only the source is read from the number the
  // conversation happened on.
  const targetRef = simulatorRef(c, SIMULATOR_PHONE);
  if (!targetRef) return c.json(NO_ACCOUNT, 400);

  const sourceRef = replaySourceRef(c, sourcePhone, sourceChannel);

  // Source must be a conversation in the caller's own tenant.
  const sourceConv = sourceRef ? findConversation(sourceRef) : null;

  if (!sourceRef || !sourceConv) {
    return c.json({ error: "Source conversation not found" }, 404);
  }

  const sourceMessages = WhatsAppService.getMessageHistory(sourceRef, 1000);

  // Reset simulator first
  resetSession(targetRef);
  WhatsAppService.clearMessageHistory(targetRef);

  // Create/update simulator conversation with source data
  getOrCreateConversation(targetRef, true);

  // Update context data and state
  db.prepare(
    `UPDATE conversations
     SET context_data = ?,
       client_name = ?,
       dni = ?,
       segment = ?,
       credit_line = ?,
       nse = ?,
       is_calidda_client = ?
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
  ).run(
    sourceConv.context_data,
    sourceConv.client_name,
    sourceConv.dni,
    sourceConv.segment,
    sourceConv.credit_line,
    sourceConv.nse,
    sourceConv.is_calidda_client,
    targetRef.tenantId,
    targetRef.channelAccountId,
    targetRef.phoneNumber,
  );

  // Copy messages in chronological order
  for (const msg of sourceMessages.reverse()) {
    WhatsAppService.logMessage(
      targetRef,
      msg.direction,
      msg.type,
      msg.content,
      msg.status,
    );
  }

  return c.json({
    status: "loaded",
    simulatorPhone: SIMULATOR_PHONE,
    messageCount: sourceMessages.length,
  });
});

export default simulator;

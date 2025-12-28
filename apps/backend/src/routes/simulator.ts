import { Hono } from "hono";
import { processMessage } from "../agent/engine.ts";
import { WhatsAppService } from "../services/whatsapp.ts";
import { getOrCreateConversation, resetSession, updateConversationState } from "../agent/context.ts";
import { db } from "../db/index.ts";
import type { Conversation } from "@totem/types";

const simulator = new Hono();

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

    // Process message through engine (same path as webhook)
    await processMessage(phoneNumber, message);

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
    const simulatorPhone = "51900000001";

    // Reset simulator first
    resetSession(simulatorPhone);
    WhatsAppService.clearMessageHistory(simulatorPhone);

    // Create/update simulator conversation with source data
    const conv = getOrCreateConversation(simulatorPhone, true);
    
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
         WHERE phone_number = ?`
    ).run(
        sourceConv.client_name,
        sourceConv.dni,
        sourceConv.segment,
        sourceConv.credit_line,
        sourceConv.nse,
        sourceConv.is_calidda_client,
        simulatorPhone
    );

    // Copy messages in chronological order
    for (const msg of sourceMessages.reverse()) {
        WhatsAppService.logMessage(
            simulatorPhone,
            msg.direction,
            msg.type,
            msg.content,
            msg.status
        );
    }

    return c.json({ 
        status: "loaded", 
        simulatorPhone,
        messageCount: sourceMessages.length 
    });
});

export default simulator;

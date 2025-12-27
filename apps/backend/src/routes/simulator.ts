import { Hono } from "hono";
import { processMessage } from "../agent/engine.ts";
import { WhatsAppService } from "../services/whatsapp.ts";
import { getOrCreateConversation, resetSession } from "../agent/context.ts";

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

export default simulator;

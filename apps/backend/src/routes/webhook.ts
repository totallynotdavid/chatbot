import { Hono } from "hono";
import process from "node:process";
import { enqueueMessage } from "../modules/chat/queue.ts";
import { WhatsAppService } from "../services/whatsapp/index.ts";

const webhook = new Hono();

// webhook verification (GET)
webhook.get("/", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (
    mode === "subscribe" &&
    token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  ) {
    return c.text(challenge || "");
  }

  return c.text("Forbidden", 403);
});

// webhook message handler (POST)
webhook.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return c.json({ status: "no_message" });
    }

    const phoneNumber = message.from;

    // Ignore system messages or empty messages
    if (phoneNumber === "0" || !phoneNumber) {
      return c.json({ status: "ignored_system_message" });
    }

    if (message.type !== "text") {
      // Silently ignore non-text messages - let state machine handle user experience
      // This prevents spam when users send multiple images/voice messages
      return c.json({ status: "non_text_ignored", type: message.type });
    }

    const text = message.text.body;
    const messageId = message.id;
    const timestamp = message.timestamp || Math.floor(Date.now() / 1000);

    // Show typing indicator (non-blocking)
    WhatsAppService.markAsReadAndShowTyping(messageId).catch((err) =>
      console.error("Failed to mark as read:", err),
    );

    // Log inbound message
    WhatsAppService.logMessage(
      phoneNumber,
      "inbound",
      "text",
      text,
      "received",
    );

    // Enqueue message for async processing (DB-backed, survives restarts)
    enqueueMessage(phoneNumber, text, timestamp, messageId);

    // Return immediately - processor handles it async
    return c.json({ status: "queued" });
  } catch (error) {
    console.error("Webhook error:", error);
    return c.json({ status: "error" }, 500);
  }
});

export default webhook;

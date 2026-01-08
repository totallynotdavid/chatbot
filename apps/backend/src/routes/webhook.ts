import { Hono } from "hono";
import process from "node:process";
import { enqueueMessage } from "../modules/chat/queue.ts";
import { WhatsAppService } from "../services/whatsapp/index.ts";

const webhook = new Hono();

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

webhook.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return c.json({ status: "no_message" });
    }

    const phoneNumber = message.from;

    if (phoneNumber === "0" || !phoneNumber) {
      return c.json({ status: "ignored_system_message" });
    }

    if (message.type !== "text") {
      return c.json({ status: "non_text_ignored", type: message.type });
    }

    const text = message.text.body;
    const messageId = message.id;
    const timestamp = message.timestamp || Math.floor(Date.now() / 1000);

    WhatsAppService.markAsReadAndShowTyping(messageId).catch((err) =>
      console.error("Failed to mark as read:", err),
    );

    WhatsAppService.logMessage(
      phoneNumber,
      "inbound",
      "text",
      text,
      "received",
    );

    enqueueMessage(phoneNumber, text, timestamp, messageId);

    return c.json({ status: "queued" });
  } catch (error) {
    console.error("Webhook error:", error);
    return c.json({ status: "error" }, 500);
  }
});

export default webhook;

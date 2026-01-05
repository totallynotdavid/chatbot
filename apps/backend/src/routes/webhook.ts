import { Hono } from "hono";
import process from "node:process";
import { debounceMessage } from "../agent/debouncer.ts";
import { processMessage } from "../agent/engine.ts";
import { WhatsAppService } from "../services/whatsapp/index.ts";
import { IMAGE_REJECTED, NON_TEXT_REJECTED } from "@totem/core";

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

    if (message.type !== "text") {
      if (message.type === "image" || message.type === "document") {
        const msg =
          IMAGE_REJECTED[Math.floor(Math.random() * IMAGE_REJECTED.length)] ??
          IMAGE_REJECTED[0] ??
          "";
        await WhatsAppService.sendMessage(phoneNumber, msg);
      }
      // Generic rejection for audio/video/stickers/etc
      else {
        const msg =
          NON_TEXT_REJECTED[
            Math.floor(Math.random() * NON_TEXT_REJECTED.length)
          ] ??
          NON_TEXT_REJECTED[0] ??
          "";
        await WhatsAppService.sendMessage(phoneNumber, msg);
      }

      return c.json({ status: "non_text_rejected", type: message.type });
    }

    const text = message.text.body;
    const messageId = message.id;

    // Show typing indicator
    await WhatsAppService.markAsReadAndShowTyping(messageId);

    // Log inbound message
    WhatsAppService.logMessage(
      phoneNumber,
      "inbound",
      "text",
      text,
      "received",
    );

    // Debounce and process
    debounceMessage(phoneNumber, text, async (phone, aggregatedText) => {
      await processMessage(phone, aggregatedText);
    });

    return c.json({ status: "queued" });
  } catch (error) {
    console.error("Webhook error:", error);
    return c.json({ status: "error" }, 500);
  }
});

export default webhook;

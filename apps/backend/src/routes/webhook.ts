import { Hono } from "hono";
import process from "node:process";
import { WhatsAppService } from "../adapters/whatsapp/index.ts";
import { isMaintenanceMode } from "../domains/settings/system.ts";
import { holdMessage } from "../conversation/held-messages.ts";
import { storeIncomingMessage } from "../conversation/message-inbox.ts";
import { parseIncomingMessage } from "../adapters/whatsapp/parsers/index.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("webhook");

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
  let phoneNumber: string | undefined;
  try {
    const body = await c.req.json();
    const webhookMessage = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!webhookMessage) {
      return c.json({ status: "no_message" });
    }

    const incomingMessage = parseIncomingMessage(webhookMessage);
    phoneNumber = incomingMessage.from;

    if (incomingMessage.quotedContext) {
      const quotedMessageContent = WhatsAppService.getMessageById(
        incomingMessage.quotedContext.id,
      );
      if (quotedMessageContent) {
        incomingMessage.quotedContext.body = quotedMessageContent.content;
        incomingMessage.quotedContext.type = quotedMessageContent.type;
        incomingMessage.quotedContext.timestamp = new Date(
          quotedMessageContent.created_at,
        ).getTime();
      }
    }

    // Log quoted message detection
    if (incomingMessage.quotedContext) {
      logger.info(
        {
          messageId: incomingMessage.id,
          from: phoneNumber,
          quotedMessage: incomingMessage.quotedContext,
        },
        "Quoted message received",
      );
    }

    if (phoneNumber === "0" || !phoneNumber) {
      return c.json({ status: "ignored_system_message" });
    }

    if (incomingMessage.type !== "text") {
      return c.json({ status: "non_text_ignored", type: incomingMessage.type });
    }

    if (incomingMessage.quotedContext) {
      const quotedProductId = WhatsAppService.findProductByQuotedMessage(
        incomingMessage.quotedContext.id,
      );
      if (quotedProductId) {
        logger.info(
          {
            messageId: incomingMessage.id,
            quotedMessageId: incomingMessage.quotedContext.id,
            quotedProductId,
          },
          "Resolved product from quoted message",
        );
      }
    }

    WhatsAppService.logMessage(
      phoneNumber,
      "inbound",
      "text",
      incomingMessage.body,
      "received",
    );

    // During maintenance, hold messages for later processing
    if (isMaintenanceMode()) {
      holdMessage(
        phoneNumber,
        incomingMessage.body,
        incomingMessage.id,
        incomingMessage.timestamp,
      );
      return c.json({ status: "maintenance_held" });
    }

    storeIncomingMessage(incomingMessage);

    return c.json({ status: "received" });
  } catch (error) {
    logger.error({ error, phoneNumber }, "Webhook processing failed");
    return c.json({ status: "error" }, 500);
  }
});

export default webhook;

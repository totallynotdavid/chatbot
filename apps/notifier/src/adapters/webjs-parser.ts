import type { Message } from "whatsapp-web.js";
import type {
  IncomingMessage,
  InboundMessageType,
  QuotedMessageContext,
} from "@vendeya/types";
import { extractPhoneNumber } from "../lib/whatsapp-formatters.ts";
import { createLogger } from "../logger.ts";

const logger = createLogger("webjs-parser");

function mapWebjsType(webjsType: string): InboundMessageType {
  switch (webjsType) {
    case "chat":
      return "text";
    case "image":
      return "image";
    case "document":
      return "document";
    case "ptt": // Push to talk (voice message)
    case "audio":
      return "audio";
    case "video":
      return "video";
    default:
      return "text"; // Default fallback
  }
}

export async function parseIncomingMessage(
  msg: Message,
): Promise<IncomingMessage> {
  let quotedContext: QuotedMessageContext | undefined;

  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      quotedContext = {
        id: quoted.id._serialized,
        body: quoted.body,
        type: mapWebjsType(quoted.type),
        timestamp: quoted.timestamp * 1000,
      };
    } catch (error) {
      logger.warn(
        { error, messageId: msg.id._serialized },
        "Failed to extract quoted message",
      );
      // Don't fail the whole message processing for quoted message issues
    }
  }

  // WhatsApp's @lid format (device-linked contacts) requires resolving the contact to get the phone number.
  let phoneNumber = extractPhoneNumber(msg.from);
  if (msg.from.endsWith("@lid")) {
    try {
      const contact = await msg.getContact();
      if (contact.number) {
        phoneNumber = contact.number;
      }
    } catch (e) {
      logger.warn({ lid: msg.from }, "LID resolution failed");
    }
  }

  return {
    id: msg.id._serialized,
    from: phoneNumber,
    body: msg.body,
    type: mapWebjsType(msg.type),
    // whatsapp-web.js reports Unix seconds; IncomingMessage carries milliseconds.
    timestamp: msg.timestamp * 1000,
    quotedContext,
  };
}

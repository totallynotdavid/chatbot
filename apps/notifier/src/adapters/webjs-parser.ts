import type { Message } from "whatsapp-web.js";
import type {
  IncomingMessage,
  MessageType,
  QuotedMessageContext,
} from "@totem/types";
import { extractPhoneNumber } from "@totem/whatsapp-utils";
import { createLogger } from "../logger.ts";

const logger = createLogger("webjs-parser");

function mapWebjsType(webjsType: string): MessageType {
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
        timestamp: quoted.timestamp,
      };
    } catch (error) {
      logger.warn(
        { error, messageId: msg.id._serialized },
        "Failed to extract quoted message",
      );
      // Don't fail the whole message processing for quoted message issues
    }
  }

  // Handle @lid format by trying to get actual phone number
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
    timestamp: msg.timestamp,
    quotedContext,
  };
}

import type {
  IncomingMessage,
  MessageType,
  QuotedMessageContext,
} from "@totem/types";

function mapCloudApiType(cloudApiType: string): MessageType {
  switch (cloudApiType) {
    case "text":
      return "text";
    case "image":
      return "image";
    case "document":
      return "document";
    case "audio":
      return "audio";
    case "video":
      return "video";
    default:
      return "text"; // Default fallback
  }
}

export function parseIncomingMessage(webhookMessage: any): IncomingMessage {
  // Format: { "context": { "from": "sender_id", "id": "quoted_message_id" } }
  let quotedContext: QuotedMessageContext | undefined;

  if (webhookMessage.context?.id) {
    quotedContext = {
      id: webhookMessage.context.id,
      body: "", // Will be populated by looking up the message in our store
      type: "text", // Default to text since Business API doesn't provide original type
      timestamp: 0, // Will be populated by looking up the message in our store
    };
  }

  return {
    id: webhookMessage.id,
    from: webhookMessage.from,
    body: webhookMessage.text?.body || "",
    type: mapCloudApiType(webhookMessage.type),
    timestamp:
      (webhookMessage.timestamp || Math.floor(Date.now() / 1000)) * 1000,
    quotedContext,
  };
}

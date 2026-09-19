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
      return "unknown";
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

/** Which of our numbers the message arrived on, and under which WABA. */
export type InboundRouting = {
  /** Meta's `metadata.phone_number_id` - the account key we route on. */
  phoneNumberId: string | null;
  /** Human-readable number, useful for first-time account registration. */
  displayPhoneNumber: string | null;
  /** `entry[].id` is the WhatsApp Business Account id. */
  wabaId: string | null;
};

/** One `entry[].changes[]` element: the number it arrived on, and its messages. */
export type ParsedChange = {
  routing: InboundRouting;
  /** Empty for a change that carried no messages (status callbacks, echoes). */
  messages: IncomingMessage[];
};

/**
 * Flatten a Cloud API webhook body into its changes.
 *
 * Every level of the payload is an array because one POST can batch events for
 * several WhatsApp Business Accounts and several numbers - which, now that one
 * endpoint serves every tenant, routinely means several tenants at once. Taking
 * `entry[0].changes[0].messages[0]` silently dropped everything else while still
 * answering 200, so Meta never redelivered it. Nothing is dropped here; the
 * caller routes and handles each change on its own account.
 *
 * Routing is returned even for a change with no messages, so callers can log
 * deliveries from numbers we do not know about.
 */
export function parseWebhookBody(body: any): ParsedChange[] {
  const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];

  return entries.flatMap((entry) => {
    const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];

    return changes.map((change): ParsedChange => {
      const value = change?.value;
      const messages: any[] = Array.isArray(value?.messages)
        ? value.messages
        : [];

      return {
        routing: {
          phoneNumberId: value?.metadata?.phone_number_id ?? null,
          displayPhoneNumber: value?.metadata?.display_phone_number ?? null,
          wabaId: entry?.id ?? null,
        },
        messages: messages.map(parseIncomingMessage),
      };
    });
  });
}

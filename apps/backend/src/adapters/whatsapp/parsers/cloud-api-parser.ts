import type {
  IncomingMessage,
  InboundMessageType,
  QuotedMessageContext,
} from "@vendeya/types";

function mapCloudApiType(cloudApiType: string): InboundMessageType {
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
  let quotedContext: QuotedMessageContext | undefined;

  if (webhookMessage.context?.id) {
    quotedContext = {
      id: webhookMessage.context.id,
      body: "",
      type: "text",
      timestamp: 0,
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
  /** Meta's `metadata.phone_number_id`, the account key we route on. */
  phoneNumberId: string | null;
  /** Human-readable number. Routing does not use it. */
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
 * Flattens a Cloud API webhook body into its changes. The entries, the changes
 * and the messages are each arrays, because one POST can batch several WhatsApp
 * Business Accounts and numbers. Reading only the first message would drop the
 * rest while still answering 200, and Meta would not redeliver them.
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
        // Routing is returned even for a change with no messages, so callers
        // can log deliveries from numbers we do not know about.
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

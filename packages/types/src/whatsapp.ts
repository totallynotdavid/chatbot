/** The types `messages.type` can hold. */
export type StoredMessageType = "text" | "image";

/** What a channel can deliver. Only the stored types are kept in `messages`. */
export type InboundMessageType =
  | StoredMessageType
  | "document"
  | "audio"
  | "video"
  | "unknown";

export type QuotedMessageContext = {
  id: string;
  body: string;
  type: InboundMessageType;
  timestamp: number;
};

export type IncomingMessage = {
  id: string;
  from: string;
  body: string;
  type: InboundMessageType;
  timestamp: number;
  quotedContext?: QuotedMessageContext;
};

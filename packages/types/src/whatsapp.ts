export type MessageType =
  | "text"
  | "image"
  | "document"
  | "audio"
  | "video"
  | "unknown";

export type QuotedMessageContext = {
  id: string;
  body: string;
  type: MessageType;
  timestamp: number;
};

export type IncomingMessage = {
  id: string;
  from: string;
  body: string;
  type: MessageType;
  timestamp: number;
  quotedContext?: QuotedMessageContext;
};

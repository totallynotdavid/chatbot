import type {
  ChannelAccount,
  ConversationMessage,
  StoredMessageType,
} from "@totem/types";

/**
 * What a send did. Repeating a `permanent` failure will not help. A `transient`
 * failure is one a later attempt can succeed after, such as a rate limit or a
 * connection that never opened. An `ambiguous` send may have been accepted, so
 * repeating it can deliver the message twice. `reason` is a short stable label
 * for logs. It holds no token, no message text and no phone number.
 */
export type SendOutcome =
  | { ok: true; messageId: string }
  | {
      ok: false;
      kind: "permanent" | "transient" | "ambiguous";
      reason: string;
      status?: number;
    };

/**
 * Every send takes the channel account it goes out on. Credentials and the
 * sending phone-number id come from that account, never from module-level env.
 */
export interface WhatsAppAdapter {
  sendMessage(
    account: ChannelAccount,
    to: string,
    content: string,
  ): Promise<SendOutcome>;
  sendImage(
    account: ChannelAccount,
    to: string,
    imagePath: string,
    caption?: string,
  ): Promise<SendOutcome>;
  markAsRead(account: ChannelAccount, messageId: string): Promise<void>;
}

export type MessageDirection = "inbound" | "outbound";

export type { ChannelAccount, ConversationMessage, StoredMessageType };

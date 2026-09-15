import type {
  ChannelAccount,
  ConversationMessage,
  MessageType,
} from "@totem/types";

/**
 * Every send takes the channel account it goes out on. Credentials and the
 * sending phone-number id come from that account, never from module-level env.
 */
export interface WhatsAppAdapter {
  sendMessage(
    account: ChannelAccount,
    to: string,
    content: string,
  ): Promise<string | null>;
  sendImage(
    account: ChannelAccount,
    to: string,
    imagePath: string,
    caption?: string,
  ): Promise<string | null>;
  markAsRead(account: ChannelAccount, messageId: string): Promise<void>;
}

export type MessageDirection = "inbound" | "outbound";

export type { ChannelAccount, ConversationMessage, MessageType };

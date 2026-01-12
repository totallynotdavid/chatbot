import process from "node:process";
import type {
  ConversationMessage,
  WhatsAppAdapter,
  MessageType,
} from "./types.ts";
import { CloudApiAdapter } from "./cloud-api.ts";
import { DevAdapter } from "./dev-adapter.ts";
import { MessageStore } from "./message-store.ts";

const IS_DEV = process.env.NODE_ENV === "development";

function getAdapter(): WhatsAppAdapter {
  if (IS_DEV) {
    return DevAdapter;
  }
  return CloudApiAdapter;
}

const adapter = getAdapter();

export const WhatsAppService = {
  async sendMessage(to: string, content: string): Promise<void> {
    const messageId = await adapter.sendMessage(to, content);
    const status = messageId ? "sent" : "failed";
    MessageStore.log(
      to,
      "outbound",
      "text",
      content,
      status,
      messageId ?? undefined,
    );
  },

  async sendImage(
    to: string,
    imagePath: string,
    caption?: string,
    productId?: string,
  ): Promise<void> {
    const messageId = await adapter.sendImage(to, imagePath, caption);
    const status = messageId ? "sent" : "failed";
    MessageStore.log(
      to,
      "outbound",
      "image",
      imagePath,
      status,
      messageId ?? undefined,
      productId,
    );
  },

  async markAsReadAndShowTyping(messageId: string): Promise<void> {
    await adapter.markAsRead(messageId);
  },

  logMessage(
    phoneNumber: string,
    direction: "inbound" | "outbound",
    type: MessageType,
    content: string,
    status: string = "sent",
  ): void {
    MessageStore.log(phoneNumber, direction, type, content, status);
  },

  getMessageHistory(
    phoneNumber: string,
    limit: number = 50,
  ): ConversationMessage[] {
    return MessageStore.getHistory(phoneNumber, limit);
  },

  clearMessageHistory(phoneNumber: string): void {
    MessageStore.clear(phoneNumber);
  },

  findProductByQuotedMessage(whatsappMessageId: string): string | null {
    return MessageStore.findProductByMessageId(whatsappMessageId);
  },

  getMessageById(whatsappMessageId: string): ConversationMessage | null {
    return MessageStore.getMessageById(whatsappMessageId);
  },
};

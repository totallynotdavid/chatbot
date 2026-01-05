import process from "node:process";
import type { Message, WhatsAppAdapter } from "./types.ts";
import { CloudApiAdapter } from "./cloud-api.ts";
import { DevAdapter } from "./dev-adapter.ts";
import { MessageStore } from "./message-store.ts";

const IS_DEV = process.env.NODE_ENV === "development";

function getAdapter(): WhatsAppAdapter {
  if (IS_DEV) {
    console.log("[WhatsApp] Dev mode: using whatsapp-web.js via notifier");
    return DevAdapter;
  }
  return CloudApiAdapter;
}

const adapter = getAdapter();

export const WhatsAppService = {
  async sendMessage(to: string, content: string): Promise<void> {
    const success = await adapter.sendMessage(to, content);
    const status = success ? "sent" : "failed";
    MessageStore.log(to, "outbound", "text", content, status);
  },

  async sendImage(
    to: string,
    imagePath: string,
    caption?: string,
  ): Promise<void> {
    const success = await adapter.sendImage(to, imagePath, caption);
    const status = success ? "sent" : "failed";
    MessageStore.log(to, "outbound", "image", imagePath, status);
  },

  async markAsReadAndShowTyping(messageId: string): Promise<void> {
    await adapter.markAsRead(messageId);
  },

  logMessage(
    phoneNumber: string,
    direction: "inbound" | "outbound",
    type: "text" | "image",
    content: string,
    status: string = "sent",
  ): void {
    MessageStore.log(phoneNumber, direction, type, content, status);
  },

  getMessageHistory(phoneNumber: string, limit: number = 50): Message[] {
    return MessageStore.getHistory(phoneNumber, limit);
  },

  clearMessageHistory(phoneNumber: string): void {
    MessageStore.clear(phoneNumber);
  },
};

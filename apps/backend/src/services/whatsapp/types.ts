import type { Message } from "@totem/types";

export type WhatsAppAdapter = {
  sendMessage(to: string, content: string): Promise<boolean>;
  sendImage(to: string, imagePath: string, caption?: string): Promise<boolean>;
  markAsRead(messageId: string): Promise<void>;
};

export type MessageDirection = "inbound" | "outbound";
export type MessageType = "text" | "image";

export type { Message };

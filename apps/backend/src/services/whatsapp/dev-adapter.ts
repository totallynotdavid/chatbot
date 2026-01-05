import process from "node:process";
import type { WhatsAppAdapter } from "./types.ts";

const NOTIFIER_URL = process.env.NOTIFIER_URL || "http://localhost:3001";
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

export const DevAdapter: WhatsAppAdapter = {
  async sendMessage(to: string, content: string): Promise<boolean> {
    try {
      const response = await fetch(`${NOTIFIER_URL}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: to, content }),
      });

      if (!response.ok) {
        console.error("[DevAdapter] Send failed:", await response.text());
        return false;
      }

      return true;
    } catch (error) {
      console.error("[DevAdapter] Send error:", error);
      return false;
    }
  },

  async sendImage(
    to: string,
    imagePath: string,
    caption?: string,
  ): Promise<boolean> {
    const imageUrl = `${PUBLIC_URL}/static/${imagePath}`;

    try {
      const response = await fetch(`${NOTIFIER_URL}/send-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: to, imageUrl, caption }),
      });

      if (!response.ok) {
        console.error("[DevAdapter] Image failed:", await response.text());
        return false;
      }

      return true;
    } catch (error) {
      console.error("[DevAdapter] Image error:", error);
      return false;
    }
  },

  async markAsRead(_messageId: string): Promise<void> {
    // whatsapp-web.js handles read receipts automatically
  },
};

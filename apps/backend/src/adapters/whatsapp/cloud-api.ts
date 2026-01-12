import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WhatsAppAdapter } from "./types.ts";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("whatsapp");
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

function getPublicUrl(): string {
  const tunnelFile = resolve(import.meta.dir, "../../../../.cloudflare-url");
  if (existsSync(tunnelFile)) {
    const url = readFileSync(tunnelFile, "utf-8").trim();
    if (url) {
      logger.debug({ url, source: "tunnel" }, "Public URL configured");
      return url;
    }
  }
  const fallback = process.env.PUBLIC_URL || "http://localhost:3000";
  logger.debug({ url: fallback, source: "env" }, "Public URL configured");
  return fallback;
}

const PUBLIC_URL = getPublicUrl();
const API_URL = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;

export const CloudApiAdapter: WhatsAppAdapter = {
  async sendMessage(to: string, content: string): Promise<boolean> {
    if (!TOKEN || !PHONE_ID) {
      logger.warn("WhatsApp not configured");
      return false;
    }

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: content },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        logger.error(
          { error, to, status: response.status },
          "WhatsApp send failed",
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error({ error, to }, "WhatsApp send failed");
      return false;
    }
  },

  async sendImage(
    to: string,
    imagePath: string,
    caption?: string,
  ): Promise<boolean> {
    if (!TOKEN || !PHONE_ID) {
      logger.warn({ imagePath }, "WhatsApp not configured");
      return false;
    }

    const link = `${PUBLIC_URL}/static/${imagePath}`;

    try {
      const payload: Record<string, unknown> = {
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { link, ...(caption && { caption }) },
      };

      logger.debug(
        { to, link, caption, publicUrl: PUBLIC_URL },
        "Attempting to send image",
      );

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        logger.error(
          {
            error,
            to,
            imagePath,
            link,
            status: response.status,
            publicUrl: PUBLIC_URL,
          },
          "WhatsApp image send failed",
        );
        return false;
      }

      logger.info({ to, link }, "Image sent successfully");
      return true;
    } catch (error) {
      logger.error(
        { error, to, imagePath, link },
        "WhatsApp image send failed",
      );
      return false;
    }
  },

  async markAsRead(messageId: string): Promise<void> {
    if (!TOKEN || !PHONE_ID) return;

    try {
      await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
      });
    } catch {
      // Non-critical, silently fail
    }
  },
};

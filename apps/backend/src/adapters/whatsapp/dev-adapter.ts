import type { ChannelAccount, WhatsAppAdapter } from "./types.ts";
import { createLogger } from "../../lib/logger.ts";
import { getNotifierUrl, getPublicUrl } from "@totem/utils";
import { createAbortTimeout, TIMEOUTS } from "../../config/timeouts.ts";

const logger = createLogger("whatsapp");

const notifierUrl = getNotifierUrl();
const publicUrl = getPublicUrl();

/**
 * Applies the same active-account check as the Cloud adapter. A number being
 * set up sits in `pending` during development, so skipping the check here
 * would hide a refusal that only production shows.
 */
function maySend(account: ChannelAccount): boolean {
  if (account.status === "active") return true;

  logger.warn(
    { channelAccountId: account.id, status: account.status },
    "Channel account is not active",
  );
  return false;
}

export const DevAdapter: WhatsAppAdapter = {
  async sendMessage(
    account: ChannelAccount,
    to: string,
    content: string,
  ): Promise<string | null> {
    if (!maySend(account)) return null;

    const { signal, cleanup } = createAbortTimeout(TIMEOUTS.WHATSAPP_SEND);

    try {
      const response = await fetch(`${notifierUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: to, content }),
        signal,
      });

      cleanup();

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          {
            to,
            channelAccountId: account.id,
            status: response.status,
            error: errorText,
          },
          "Dev adapter send failed",
        );
        return null;
      }

      const data = (await response.json()) as {
        status: string;
        messageId?: string;
      };

      return data.messageId ?? null;
    } catch (error) {
      cleanup();

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          logger.error(
            {
              to,
              channelAccountId: account.id,
              timeoutMs: TIMEOUTS.WHATSAPP_SEND,
            },
            "Dev adapter send timeout",
          );
        } else {
          logger.error(
            { error, to, channelAccountId: account.id },
            "Dev adapter send error",
          );
        }
      }

      return null;
    }
  },

  async sendImage(
    account: ChannelAccount,
    to: string,
    imagePath: string,
    caption?: string,
  ): Promise<string | null> {
    if (!maySend(account)) return null;

    const imageUrl = `${publicUrl}/media/${imagePath}`;

    const { signal, cleanup } = createAbortTimeout(TIMEOUTS.WHATSAPP_IMAGE);

    try {
      const response = await fetch(`${notifierUrl}/send-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: to, imageUrl, caption }),
        signal,
      });

      cleanup();

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { to, imagePath, channelAccountId: account.id, error: errorText },
          "Dev adapter image send failed",
        );
        return null;
      }

      const data = (await response.json()) as {
        status: string;
        messageId?: string;
      };

      return data.messageId ?? null;
    } catch (error) {
      cleanup();

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          logger.error(
            {
              to,
              imagePath,
              channelAccountId: account.id,
              timeoutMs: TIMEOUTS.WHATSAPP_IMAGE,
            },
            "Dev adapter image send timeout",
          );
        } else {
          logger.error(
            { error, to, imagePath, channelAccountId: account.id },
            "Dev adapter image send error",
          );
        }
      }

      return null;
    }
  },

  async markAsRead(
    _account: ChannelAccount,
    _messageId: string,
  ): Promise<void> {
    // whatsapp-web.js handles read receipts automatically
  },
};

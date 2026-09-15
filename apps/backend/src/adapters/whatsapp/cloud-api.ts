import type { ChannelAccount, WhatsAppAdapter } from "./types.ts";
import { createLogger } from "../../lib/logger.ts";
import { getPublicUrl } from "@totem/utils";
import { createAbortTimeout, TIMEOUTS } from "../../config/timeouts.ts";
import { ChannelAccountService } from "../../domains/channels/accounts.ts";

const logger = createLogger("whatsapp");

const GRAPH_VERSION = "v17.0";

function messagesUrl(account: ChannelAccount): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${account.phone_number_id}/messages`;
}

/**
 * Credentials for one send. Returns null (and logs why) when the account cannot
 * currently send, so callers degrade the same way the old env-var check did.
 */
function credentials(
  account: ChannelAccount,
): { token: string; url: string } | null {
  if (account.status !== "active") {
    logger.warn(
      { channelAccountId: account.id, status: account.status },
      "Channel account is not active",
    );
    return null;
  }

  const token = ChannelAccountService.getAccessToken(account);
  if (!token) {
    logger.warn(
      { channelAccountId: account.id },
      "Channel account has no usable access token",
    );
    return null;
  }

  return { token, url: messagesUrl(account) };
}

export const CloudApiAdapter: WhatsAppAdapter = {
  async sendMessage(
    account: ChannelAccount,
    to: string,
    content: string,
  ): Promise<string | null> {
    const creds = credentials(account);
    if (!creds) return null;

    const { signal, cleanup } = createAbortTimeout(TIMEOUTS.WHATSAPP_SEND);

    try {
      const response = await fetch(creds.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: content },
        }),
        signal,
      });

      cleanup();

      if (!response.ok) {
        const error = await response.json();
        logger.error(
          { error, to, channelAccountId: account.id, status: response.status },
          "WhatsApp send failed",
        );
        return null;
      }

      const data = (await response.json()) as {
        messages?: Array<{ id: string }>;
      };

      return data.messages?.[0]?.id ?? null;
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
            "WhatsApp send timeout",
          );
        } else {
          logger.error(
            { error, to, channelAccountId: account.id },
            "WhatsApp send failed",
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
    const creds = credentials(account);
    if (!creds) return null;

    const publicUrl = getPublicUrl();
    const link = `${publicUrl}/media/${imagePath}`;

    const { signal, cleanup } = createAbortTimeout(TIMEOUTS.WHATSAPP_IMAGE);

    try {
      const payload: Record<string, unknown> = {
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { link, ...(caption && { caption }) },
      };

      const response = await fetch(creds.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal,
      });

      cleanup();

      if (!response.ok) {
        const error = await response.json();
        logger.error(
          {
            error,
            to,
            imagePath,
            link,
            channelAccountId: account.id,
            status: response.status,
            payload,
          },
          "WhatsApp image send failed",
        );
        return null;
      }

      const responseData = (await response.json()) as {
        messages?: Array<{ id: string }>;
      };

      return responseData.messages?.[0]?.id ?? null;
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
            "WhatsApp image send timeout",
          );
        } else {
          logger.error(
            { error, to, imagePath, channelAccountId: account.id },
            "WhatsApp image send failed",
          );
        }
      }

      return null;
    }
  },

  async markAsRead(account: ChannelAccount, messageId: string): Promise<void> {
    const creds = credentials(account);
    if (!creds) return;

    const { signal, cleanup } = createAbortTimeout(5_000);

    try {
      await fetch(creds.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
        signal,
      });

      cleanup();
    } catch {
      cleanup();
      // Non-critical, silently fail
    }
  },
};

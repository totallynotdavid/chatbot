import type { ChannelAccount, SendOutcome, WhatsAppAdapter } from "./types.ts";
import { classifyHttpFailure, classifyThrown } from "./cloud-api.ts";
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

/**
 * Posts to the notifier. The notifier is not Meta, so a failure is classified
 * by status or thrown error only.
 */
async function postToNotifier(
  account: ChannelAccount,
  path: "/send" | "/send-image",
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<SendOutcome> {
  if (!maySend(account)) {
    return { ok: false, kind: "permanent", reason: "account_not_active" };
  }

  const { signal, cleanup } = createAbortTimeout(timeoutMs);

  try {
    const response = await fetch(`${notifierUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    const body = await response.text().catch(() => "");
    if (!response.ok) return classifyHttpFailure(response.status, body);

    let messageId: unknown;
    try {
      messageId = (JSON.parse(body) as { messageId?: unknown }).messageId;
    } catch {
      messageId = undefined;
    }
    if (typeof messageId === "string" && messageId) {
      return { ok: true, messageId };
    }
    return {
      ok: false,
      kind: "ambiguous",
      reason: "no_message_id",
      status: response.status,
    };
  } catch (error) {
    return classifyThrown(error);
  } finally {
    cleanup();
  }
}

export const DevAdapter: WhatsAppAdapter = {
  sendMessage(
    account: ChannelAccount,
    to: string,
    content: string,
  ): Promise<SendOutcome> {
    return postToNotifier(
      account,
      "/send",
      { phoneNumber: to, content },
      TIMEOUTS.WHATSAPP_SEND,
    );
  },

  sendImage(
    account: ChannelAccount,
    to: string,
    imagePath: string,
    caption?: string,
  ): Promise<SendOutcome> {
    return postToNotifier(
      account,
      "/send-image",
      { phoneNumber: to, imageUrl: `${publicUrl}/media/${imagePath}`, caption },
      TIMEOUTS.WHATSAPP_IMAGE,
    );
  },

  async markAsRead(
    _account: ChannelAccount,
    _messageId: string,
  ): Promise<void> {
    // whatsapp-web.js handles read receipts automatically
  },
};

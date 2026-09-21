import type { ChannelAccount, SendOutcome, WhatsAppAdapter } from "./types.ts";
import { createLogger } from "../../lib/logger.ts";
import { getPublicUrl } from "@vendeya/utils";
import { createAbortTimeout, TIMEOUTS } from "../../config/timeouts.ts";
import { ChannelAccountService } from "../../domains/channels/accounts.ts";

const logger = createLogger("whatsapp");

const GRAPH_VERSION = "v17.0";

function messagesUrl(account: ChannelAccount): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${account.phone_number_id}/messages`;
}

/**
 * Credentials for one send. Returns the reason (and logs it) when the account
 * cannot currently send.
 */
function credentials(
  account: ChannelAccount,
): { token: string; url: string } | { refusal: string } {
  if (account.status !== "active") {
    logger.warn(
      { channelAccountId: account.id, status: account.status },
      "Channel account is not active",
    );
    return { refusal: "account_not_active" };
  }

  const token = ChannelAccountService.getAccessToken(account);
  if (!token) {
    logger.warn(
      { channelAccountId: account.id },
      "Channel account has no usable access token",
    );
    return { refusal: "no_token" };
  }

  return { token, url: messagesUrl(account) };
}

type SendFailure = Extract<SendOutcome, { ok: false }>;

/**
 * Meta's throughput (130429) and pair rate-limit (131056) codes ask the sender
 * to slow down. They can arrive on a 4xx, which the status alone classifies as
 * permanent.
 */
const THROTTLE_ERROR_CODES = new Set([130429, 131056]);

/**
 * `fetch` failures that happen before the request could have reached Meta. Bun
 * reports a refused connection as `ConnectionRefused` where Node reports
 * `ECONNREFUSED`.
 */
const NOT_SENT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ConnectionRefused",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

function metaErrorCode(body: string): number | undefined {
  try {
    const code = (JSON.parse(body) as { error?: { code?: unknown } })?.error
      ?.code;
    return Number.isInteger(code) ? (code as number) : undefined;
  } catch {
    return undefined;
  }
}

function messageIdOf(body: string): string | undefined {
  try {
    const id = (JSON.parse(body) as { messages?: Array<{ id?: unknown }> })
      ?.messages?.[0]?.id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/** The `code` of a thrown fetch error, kept only when it is a plain identifier. */
function errorCode(error: unknown): string | undefined {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    const code = (candidate as { code?: unknown } | null)?.code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code)) {
      return code;
    }
  }
  return undefined;
}

/** Classifies a response that was not a 2xx. The body may not be JSON. */
export function classifyHttpFailure(status: number, body: string): SendFailure {
  const code = metaErrorCode(body);
  const reason =
    code === undefined ? `http_${status}` : `http_${status}:${code}`;

  if (status === 429 || status >= 500) {
    return { ok: false, kind: "transient", reason, status };
  }
  if (status >= 400) {
    const throttled = code !== undefined && THROTTLE_ERROR_CODES.has(code);
    return {
      ok: false,
      kind: throttled ? "transient" : "permanent",
      reason,
      status,
    };
  }
  return { ok: false, kind: "ambiguous", reason, status };
}

/** Classifies an error thrown by `fetch`. */
export function classifyThrown(error: unknown): SendFailure {
  if ((error as { name?: unknown } | null)?.name === "AbortError") {
    return { ok: false, kind: "ambiguous", reason: "timeout" };
  }

  const code = errorCode(error);
  return {
    ok: false,
    kind: code && NOT_SENT_ERROR_CODES.has(code) ? "transient" : "ambiguous",
    reason: code ? `network:${code}` : "network_error",
  };
}

/**
 * Posts one payload to the account's messages endpoint. `sendMessage` and
 * `sendImage` both post through here, so they classify a failure the same way.
 */
async function post(
  account: ChannelAccount,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<SendOutcome> {
  const creds = credentials(account);
  if ("refusal" in creds) {
    return { ok: false, kind: "permanent", reason: creds.refusal };
  }

  const { signal, cleanup } = createAbortTimeout(timeoutMs);

  try {
    const response = await fetch(creds.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });

    // A body that cannot be read leaves the status to classify by.
    const body = await response.text().catch(() => "");

    if (!response.ok) return classifyHttpFailure(response.status, body);

    const messageId = messageIdOf(body);
    if (messageId) return { ok: true, messageId };
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

export const CloudApiAdapter: WhatsAppAdapter = {
  sendMessage(
    account: ChannelAccount,
    to: string,
    content: string,
  ): Promise<SendOutcome> {
    return post(
      account,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: content },
      },
      TIMEOUTS.WHATSAPP_SEND,
    );
  },

  sendImage(
    account: ChannelAccount,
    to: string,
    imagePath: string,
    caption?: string,
  ): Promise<SendOutcome> {
    const link = `${getPublicUrl()}/media/${imagePath}`;

    return post(
      account,
      {
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { link, ...(caption && { caption }) },
      },
      TIMEOUTS.WHATSAPP_IMAGE,
    );
  },

  async markAsRead(account: ChannelAccount, messageId: string): Promise<void> {
    const creds = credentials(account);
    if ("refusal" in creds) return;

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

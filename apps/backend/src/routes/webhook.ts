import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import process from "node:process";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ChannelAccount,
  ConversationRef,
  IncomingMessage,
} from "@totem/types";
import { WhatsAppService } from "../adapters/whatsapp/index.ts";
import { ChannelAccountService } from "../domains/channels/accounts.ts";
import { isMaintenanceMode } from "../domains/settings/system.ts";
import { holdMessage, isHeld } from "../conversation/held-messages.ts";
import {
  isQueued,
  storeIncomingMessage,
} from "../conversation/message-inbox.ts";
import { getOrCreateConversation } from "../conversation/store.ts";
import { TenantService } from "../domains/tenants/index.ts";
import type {
  InboundRouting,
  ParsedChange,
} from "../adapters/whatsapp/parsers/index.ts";
import { parseWebhookBody } from "../adapters/whatsapp/parsers/index.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("webhook");

const webhook = new Hono();

// Meta documents webhook payloads of up to 3 MB.
const MAX_WEBHOOK_BODY_BYTES = 3 * 1024 * 1024;

// `bodyLimit` counts the bytes of a chunked body that has no Content-Length.
// The route runs it ahead of the signature check because the endpoint is public.
const limitWebhookBody = bodyLimit({
  maxSize: MAX_WEBHOOK_BODY_BYTES,
  onError: (c) => {
    logger.warn("Webhook POST rejected: body over the size limit");
    return c.json({ error: "payload_too_large" }, 413);
  },
});

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Meta's verification handshake carries no phone-number id, so the token is the
 * only thing identifying the caller. Any channel account whose verify token
 * matches answers the challenge. The env var stays as the fallback for the
 * account seeded from it.
 */
function verifyTokenMatches(token: string): ChannelAccount | "env" | null {
  for (const account of ChannelAccountService.listWithVerifyToken()) {
    const stored = ChannelAccountService.getVerifyToken(account);
    if (stored && constantTimeEquals(stored, token)) {
      return account;
    }
  }

  const envToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (envToken && constantTimeEquals(envToken, token)) {
    return "env";
  }

  return null;
}

const SIGNATURE_PREFIX = "sha256=";
const SIGNATURE_LENGTH = SIGNATURE_PREFIX.length + 64;
const HEX_DIGEST = /^[0-9a-f]+$/;

/** Why a signature header was refused, or null when it matches the raw body. */
function signatureFailure(
  rawBody: string,
  header: string | null,
  secret: string,
): string | null {
  if (!header) return "missing_header";
  if (!header.startsWith(SIGNATURE_PREFIX)) return "bad_prefix";
  if (header.length !== SIGNATURE_LENGTH) return "bad_length";
  if (!HEX_DIGEST.test(header.slice(SIGNATURE_PREFIX.length))) {
    return "non_hex";
  }

  const expected =
    SIGNATURE_PREFIX +
    createHmac("sha256", secret).update(rawBody).digest("hex");
  return constantTimeEquals(header, expected) ? null : "mismatch";
}

webhook.get("/", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode !== "subscribe" || !token) {
    return c.text("Forbidden", 403);
  }

  const match = verifyTokenMatches(token);
  if (!match) {
    logger.warn("Webhook verification rejected: no matching verify token");
    return c.text("Forbidden", 403);
  }

  logger.info(
    {
      channelAccountId: match === "env" ? null : match.id,
      source: match === "env" ? "env" : "channel_account",
    },
    "Webhook verification succeeded",
  );

  return c.text(challenge || "");
});

/**
 * Where a change's messages are meant to go, or why they go nowhere. Resolving
 * happens once per change: every message in it arrived on the same number.
 */
type Target = { account: ChannelAccount } | { rejected: string };

function resolveTarget(routing: InboundRouting): Target {
  if (!routing.phoneNumberId) {
    logger.warn(
      { wabaId: routing.wabaId },
      "Webhook payload carries no metadata.phone_number_id",
    );
    return { rejected: "unroutable_no_phone_number_id" };
  }

  const account = ChannelAccountService.getByPhoneNumberId(
    routing.phoneNumberId,
  );

  if (!account) {
    // Deliveries for numbers we do not host are dropped, not errored: Meta
    // retries 5xx responses and there is nothing to retry into.
    logger.warn(
      { phoneNumberId: routing.phoneNumberId, wabaId: routing.wabaId },
      "Inbound message for unknown channel account",
    );
    return { rejected: "unknown_channel_account" };
  }

  // Only an active account may answer. `pending` matters as much as
  // `disabled`: the send side refuses anything else (adapters/whatsapp/
  // cloud-api.ts), so accepting the message here would store it, advance the
  // conversation and leave the customer waiting on a reply that can never be
  // sent. Rejecting keeps the bot's state and the customer's experience saying
  // the same thing.
  if (account.status !== "active") {
    logger.warn(
      {
        channelAccountId: account.id,
        tenantId: account.tenant_id,
        status: account.status,
      },
      "Inbound message for a channel account that is not active",
    );
    return { rejected: `channel_account_${account.status}` };
  }

  // A suspended business is switched off, not merely barred from logging in:
  // its bot stops answering too, rather than serving customers on behalf of an
  // account that has been cut off.
  const tenant = TenantService.getById(account.tenant_id);
  if (!tenant || tenant.status !== "active") {
    logger.warn(
      {
        channelAccountId: account.id,
        tenantId: account.tenant_id,
        tenantStatus: tenant?.status ?? "missing",
      },
      "Inbound message for a tenant that is not active",
    );
    return { rejected: "tenant_not_active" };
  }

  return { account };
}

/** Handle one message on the account it arrived on. Returns what became of it. */
async function handleInbound(
  account: ChannelAccount,
  message: IncomingMessage,
): Promise<string> {
  const phoneNumber = message.from;

  if (!phoneNumber || phoneNumber === "0") {
    return "ignored_system_message";
  }

  // Meta redelivers an entire batch when the response is a 5xx, so a message
  // that already landed can arrive again next to one that did not. Its id is
  // the key on both queues, and seeing it again means there is nothing to do.
  if (isQueued(message.id) || isHeld(message.id)) {
    return "duplicate";
  }

  const ref: ConversationRef = {
    tenantId: account.tenant_id,
    channelAccountId: account.id,
    phoneNumber,
  };

  if (message.quotedContext) {
    const quotedMessageContent = WhatsAppService.getMessageById(
      ref,
      message.quotedContext.id,
    );
    if (quotedMessageContent) {
      message.quotedContext.body = quotedMessageContent.content;
      message.quotedContext.type = quotedMessageContent.type;
      message.quotedContext.timestamp = new Date(
        quotedMessageContent.created_at,
      ).getTime();
    }

    logger.info(
      {
        tenantId: ref.tenantId,
        messageId: message.id,
        from: phoneNumber,
        quotedMessage: message.quotedContext,
      },
      "Quoted message received",
    );
  }

  if (message.type !== "text") {
    logger.info(
      {
        tenantId: account.tenant_id,
        messageId: message.id,
        type: message.type,
      },
      "Ignoring a non-text message",
    );
    return "non_text_ignored";
  }

  if (message.quotedContext) {
    const quotedProductId = WhatsAppService.findProductByQuotedMessage(
      ref,
      message.quotedContext.id,
    );
    if (quotedProductId) {
      logger.info(
        {
          tenantId: ref.tenantId,
          messageId: message.id,
          quotedMessageId: message.quotedContext.id,
          quotedProductId,
        },
        "Resolved product from quoted message",
      );
    }
  }

  // The message row belongs to a conversation, so the conversation has to
  // exist before it is written. Inbound text from a contact starts one, and the
  // handler's own get-or-create later is idempotent.
  getOrCreateConversation(ref);

  WhatsAppService.logMessage(ref, "inbound", "text", message.body, "received");

  // During maintenance, hold messages for later processing
  if (isMaintenanceMode(ref.tenantId)) {
    holdMessage(ref, message.body, message.id, message.timestamp);
    return "maintenance_held";
  }

  storeIncomingMessage(ref, message);

  return "received";
}

/**
 * One POST, any number of messages. Each is routed and handled on its own
 * account so that a batch spanning two tenants delivers both, and so that one
 * failure cannot swallow the rest of the payload.
 */
webhook.post("/", limitWebhookBody, async (c) => {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    logger.warn("Webhook POST refused: WHATSAPP_APP_SECRET is not set");
    return c.json({ error: "webhook_not_configured" }, 503);
  }

  const rawBody = await c.req.text();
  const failure = signatureFailure(
    rawBody,
    c.req.header("X-Hub-Signature-256") ?? null,
    appSecret,
  );
  if (failure) {
    logger.warn({ reason: failure }, "Webhook POST rejected: bad signature");
    return c.json({ error: "invalid_signature" }, 401);
  }

  let changes: ParsedChange[];

  try {
    changes = parseWebhookBody(JSON.parse(rawBody));
  } catch (error) {
    logger.error({ error }, "Webhook body could not be parsed");
    return c.json({ error: "invalid_payload" }, 400);
  }

  const results: Array<{ phoneNumberId: string | null; status: string }> = [];
  let failed = false;

  for (const { routing, messages } of changes) {
    const phoneNumberId = routing.phoneNumberId;

    if (messages.length === 0) {
      results.push({ phoneNumberId, status: "no_message" });
      continue;
    }

    const target = resolveTarget(routing);

    if ("rejected" in target) {
      for (const _message of messages) {
        results.push({ phoneNumberId, status: target.rejected });
      }
      continue;
    }

    for (const message of messages) {
      try {
        results.push({
          phoneNumberId,
          status: await handleInbound(target.account, message),
        });
      } catch (error) {
        failed = true;
        logger.error(
          {
            error,
            phoneNumber: message.from,
            messageId: message.id,
            tenantId: target.account.tenant_id,
          },
          "Webhook processing failed",
        );
        results.push({ phoneNumberId, status: "error" });
      }
    }
  }

  // Meta redelivers the whole batch after a 5xx, so the messages that did land
  // come back with it. `handleInbound` recognises them by id and skips them.
  return failed ? c.json({ results }, 500) : c.json({ results });
});

export default webhook;

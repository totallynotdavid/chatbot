import { db } from "../../db/index.ts";
import { getOne } from "../../db/query.ts";
import type { ConversationRef } from "@totem/types";
import type { SendOutcome } from "../../adapters/whatsapp/types.ts";
import {
  ChannelUnavailableError,
  WhatsAppService,
} from "../../adapters/whatsapp/index.ts";
import { logAction } from "../../platform/audit/logger.ts";
import { withLock } from "../../conversation/locks.ts";
import { cancelPending } from "../../conversation/outbox.ts";
import {
  findConversation,
  getOrCreateConversation,
  refreshLastActivity,
  resetSession,
  updateConversation,
} from "../../conversation/store.ts";

const ALLOWED_AGENT_DATA_FIELDS = [
  "agent_notes",
  "sale_status",
  "delivery_address",
  "delivery_reference",
  "products_interested",
];

const VALID_SALE_STATUSES = ["pending", "confirmed", "rejected", "no_answer"];

const MANUAL_TAKEOVER_REASON = "Manual takeover by agent";

const IDENTITY_WHERE =
  "tenant_id = ? AND channel_account_id = ? AND phone_number = ?";

function identityParams(ref: ConversationRef): [string, string, string] {
  return [ref.tenantId, ref.channelAccountId, ref.phoneNumber];
}

export async function takeoverConversation(
  ref: ConversationRef,
  userId: string,
) {
  // A bot turn reads the phase when it starts and writes it when it ends.
  // Without the lock a takeover that lands mid-turn is overwritten and the bot
  // resumes. A turn already in flight may still send the replies it had ready.
  await withLock(ref, async () => {
    updateConversation(
      ref,
      { phase: "escalated", reason: MANUAL_TAKEOVER_REASON },
      {},
    );

    // Replies the bot still owed are dropped, because the person now answers.
    // A bot escalation does not come through here, so the "an advisor will
    // contact you" text it queued still goes out.
    const cancelledReplies = cancelPending(ref);

    logAction(
      { userId, tenantId: ref.tenantId },
      "takeover",
      "conversation",
      ref.phoneNumber,
      { cancelledReplies },
    );
  });

  return { success: true };
}

export async function releaseConversation(
  ref: ConversationRef,
  userId: string,
) {
  // The lock keeps a bot turn from writing its phase over the reset. The state
  // is read again inside it, because the row the route resolved may be stale.
  await withLock(ref, async () => {
    const row = findConversation(ref);
    if (!row) return;
    const { phase, metadata } = getOrCreateConversation(ref);

    // A conversation the bot owns is left alone, so a repeated release cannot
    // restart it.
    if (row.status !== "human_takeover" && phase.phase !== "escalated") return;

    resetSession(ref, metadata.lastCategory);

    logAction(
      { userId, tenantId: ref.tenantId },
      "release",
      "conversation",
      ref.phoneNumber,
    );
  });

  return { success: true };
}

const SEND_FAILURE_MESSAGES = {
  permanent:
    "The message could not be sent, so the customer did not receive it",
  transient:
    "WhatsApp is not accepting messages right now, so the customer did not receive it. Try again in a moment",
  ambiguous:
    "WhatsApp did not confirm the message, so it may not have reached the customer",
} as const;

export async function sendManualMessage(
  ref: ConversationRef,
  content: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!content) {
    return { success: false, error: "Message content required" };
  }

  let outcome: SendOutcome;
  try {
    outcome = await WhatsAppService.sendMessage(ref, content);
  } catch (error) {
    // The number this conversation happens on is switched off. Nothing went
    // out, so the agent is told rather than shown a message that looks sent.
    if (error instanceof ChannelUnavailableError) {
      return {
        success: false,
        error:
          "This conversation's WhatsApp number is not active, so nothing was sent",
      };
    }
    throw error;
  }

  if (!outcome.ok) {
    return { success: false, error: SEND_FAILURE_MESSAGES[outcome.kind] };
  }

  // Keeps the idle reset away from a conversation an agent is answering.
  refreshLastActivity(ref);

  logAction(
    { userId, tenantId: ref.tenantId },
    "send_message",
    "conversation",
    ref.phoneNumber,
    { message: content },
  );

  return { success: true };
}

export function declineAssignment(
  ref: ConversationRef,
  userId: string,
): { success: boolean; error?: string; clientName?: string | null } {
  const conv = getOne<{
    assigned_agent: string | null;
    client_name: string | null;
  }>(
    `SELECT assigned_agent, client_name FROM conversations WHERE ${IDENTITY_WHERE}`,
    identityParams(ref),
  );

  if (!conv || conv.assigned_agent !== userId) {
    return { success: false, error: "Not assigned to you" };
  }

  db.prepare(
    `UPDATE conversations
     SET assignment_notified_at = NULL, assigned_agent = NULL
     WHERE ${IDENTITY_WHERE}`,
  ).run(...identityParams(ref));

  logAction(
    { userId, tenantId: ref.tenantId },
    "decline_assignment",
    "conversation",
    ref.phoneNumber,
  );

  return { success: true, clientName: conv.client_name };
}

export function updateAgentData(
  ref: ConversationRef,
  userId: string,
  updates: Record<string, string | undefined>,
): { success: boolean; error?: string } {
  const validUpdates: Record<string, string> = {};

  for (const field of ALLOWED_AGENT_DATA_FIELDS) {
    if (updates[field] !== undefined) {
      validUpdates[field] = updates[field];
    }
  }

  if (
    validUpdates.sale_status &&
    !VALID_SALE_STATUSES.includes(validUpdates.sale_status)
  ) {
    return { success: false, error: "Invalid sale_status" };
  }

  const conv = getOne<{ assigned_agent: string | null }>(
    `SELECT assigned_agent FROM conversations WHERE ${IDENTITY_WHERE}`,
    identityParams(ref),
  );

  if (conv && !conv.assigned_agent) {
    validUpdates.assigned_agent = userId;
  }

  if (Object.keys(validUpdates).length === 0) {
    return { success: true };
  }

  const setClauses: string[] = [];
  const values: (string | number)[] = [];

  for (const [key, value] of Object.entries(validUpdates)) {
    setClauses.push(`${key} = ?`);
    values.push(value);
  }

  values.push(...identityParams(ref));

  db.prepare(
    `UPDATE conversations SET ${setClauses.join(", ")} WHERE ${IDENTITY_WHERE}`,
  ).run(...values);

  logAction(
    { userId, tenantId: ref.tenantId },
    "update_agent_data",
    "conversation",
    ref.phoneNumber,
    validUpdates,
  );

  return { success: true };
}

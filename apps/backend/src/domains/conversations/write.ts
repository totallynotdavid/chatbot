import { db } from "../../db/index.ts";
import { getOne } from "../../db/query.ts";
import type { ConversationRef } from "@totem/types";
import {
  ChannelUnavailableError,
  WhatsAppService,
} from "../../adapters/whatsapp/index.ts";
import { logAction } from "../../platform/audit/logger.ts";

const ALLOWED_AGENT_DATA_FIELDS = [
  "agent_notes",
  "sale_status",
  "delivery_address",
  "delivery_reference",
  "products_interested",
];

const VALID_SALE_STATUSES = ["pending", "confirmed", "rejected", "no_answer"];

const IDENTITY_WHERE =
  "tenant_id = ? AND channel_account_id = ? AND phone_number = ?";

function identityParams(ref: ConversationRef): [string, string, string] {
  return [ref.tenantId, ref.channelAccountId, ref.phoneNumber];
}

export function takeoverConversation(ref: ConversationRef, userId: string) {
  db.prepare(
    `UPDATE conversations
     SET status = 'human_takeover',
       handover_reason = 'Manual takeover by agent',
       last_activity_at = CURRENT_TIMESTAMP
     WHERE ${IDENTITY_WHERE}`,
  ).run(...identityParams(ref));

  logAction(
    { userId, tenantId: ref.tenantId },
    "takeover",
    "conversation",
    ref.phoneNumber,
    {},
  );

  return { success: true };
}

export function releaseConversation(ref: ConversationRef, userId: string) {
  db.prepare(
    `UPDATE conversations
     SET status = 'active',
       handover_reason = NULL
     WHERE ${IDENTITY_WHERE}`,
  ).run(...identityParams(ref));

  logAction(
    { userId, tenantId: ref.tenantId },
    "release",
    "conversation",
    ref.phoneNumber,
  );

  return { success: true };
}

export async function sendManualMessage(
  ref: ConversationRef,
  content: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!content) {
    return { success: false, error: "Message content required" };
  }

  try {
    await WhatsAppService.sendMessage(ref, content);
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

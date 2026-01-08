import { db } from "../../db/index.ts";
import { getOne } from "../../db/query.ts";
import { WhatsAppService } from "../../services/whatsapp/index.ts";
import { logAction } from "../../services/audit.ts";

const ALLOWED_AGENT_DATA_FIELDS = [
  "agent_notes",
  "sale_status",
  "delivery_address",
  "delivery_reference",
  "products_interested",
];

const VALID_SALE_STATUSES = ["pending", "confirmed", "rejected", "no_answer"];

export function takeoverConversation(phoneNumber: string, userId: string) {
  db.prepare(
    `UPDATE conversations
     SET status = 'human_takeover',
       handover_reason = 'Manual takeover by agent',
       last_activity_at = CURRENT_TIMESTAMP
     WHERE phone_number = ?`,
  ).run(phoneNumber);

  logAction(userId, "takeover", "conversation", phoneNumber, {});

  return { success: true };
}

export function releaseConversation(phoneNumber: string, userId: string) {
  db.prepare(
    `UPDATE conversations
     SET status = 'active',
       handover_reason = NULL
     WHERE phone_number = ?`,
  ).run(phoneNumber);

  logAction(userId, "release", "conversation", phoneNumber);

  return { success: true };
}

export async function sendManualMessage(
  phoneNumber: string,
  content: string,
  userId: string,
) {
  if (!content) {
    throw new Error("Message content required");
  }

  await WhatsAppService.sendMessage(phoneNumber, content);
  logAction(userId, "send_message", "conversation", phoneNumber, {
    message: content,
  });

  return { success: true };
}

export async function declineAssignment(
  phoneNumber: string,
  userId: string,
): Promise<{ success: boolean; error?: string; shouldReassign?: boolean; clientName?: string | null }> {
  const conv = getOne<{
    assigned_agent: string | null;
    client_name: string | null;
  }>(
    "SELECT assigned_agent, client_name FROM conversations WHERE phone_number = ?",
    [phoneNumber],
  );

  if (!conv || conv.assigned_agent !== userId) {
    return { success: false, error: "Not assigned to you" };
  }

  db.prepare(
    `UPDATE conversations 
     SET assignment_notified_at = NULL, assigned_agent = NULL 
     WHERE phone_number = ?`,
  ).run(phoneNumber);

  logAction(userId, "decline_assignment", "conversation", phoneNumber);

  return { success: true, shouldReassign: true, clientName: conv.client_name };
}

export function updateAgentData(
  phoneNumber: string,
  userId: string,
  updates: Record<string, any>,
): { success: boolean; error?: string } {
  const validUpdates: Record<string, any> = {};

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
    "SELECT assigned_agent FROM conversations WHERE phone_number = ?",
    [phoneNumber],
  );

  if (conv && !conv.assigned_agent) {
    validUpdates.assigned_agent = userId;
  }

  if (Object.keys(validUpdates).length === 0) {
    return { success: true };
  }

  const fields = Object.keys(validUpdates)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(validUpdates);

  db.prepare(`UPDATE conversations SET ${fields} WHERE phone_number = ?`).run(
    ...values,
    phoneNumber,
  );

  logAction(
    userId,
    "update_agent_data",
    "conversation",
    phoneNumber,
    validUpdates,
  );

  return { success: true };
}

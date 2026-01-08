import { db } from "../../db/index.ts";
import type { Conversation, ConversationState } from "@totem/types";
import type { StateContext } from "@totem/core";

export function getOrCreateConversation(
  phoneNumber: string,
  isSimulation = false,
): Conversation {
  let conv = db
    .prepare("SELECT * FROM conversations WHERE phone_number = ?")
    .get(phoneNumber) as Conversation | undefined;

  if (!conv) {
    db.prepare(
      "INSERT INTO conversations (phone_number, current_state, status, is_simulation) VALUES (?, ?, ?, ?)",
    ).run(phoneNumber, "INIT", "active", isSimulation ? 1 : 0);

    conv = db
      .prepare("SELECT * FROM conversations WHERE phone_number = ?")
      .get(phoneNumber) as Conversation;
  }

  return conv;
}

export function updateConversationState(
  phoneNumber: string,
  nextState: ConversationState,
  updatedContext: Partial<StateContext>,
): void {
  const conv = getOrCreateConversation(phoneNumber);
  const contextData = JSON.parse(conv.context_data || "{}");
  const mergedContext = { ...contextData, ...updatedContext };

  const updates: Record<string, any> = {
    current_state: nextState,
    context_data: JSON.stringify(mergedContext),
    last_activity_at: new Date().toISOString(),
  };

  if (updatedContext.dni) updates.dni = updatedContext.dni;
  if (updatedContext.clientName)
    updates.client_name = updatedContext.clientName;
  if (updatedContext.segment) updates.segment = updatedContext.segment;
  if (updatedContext.creditLine !== undefined)
    updates.credit_line = updatedContext.creditLine;
  if (updatedContext.nse !== undefined) updates.nse = updatedContext.nse;
  if (updatedContext.isCaliddaClient !== undefined)
    updates.is_calidda_client = updatedContext.isCaliddaClient ? 1 : 0;

  const fields = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(updates);

  db.prepare(`UPDATE conversations SET ${fields} WHERE phone_number = ?`).run(
    ...values,
    phoneNumber,
  );
}

export function escalateConversation(
  phoneNumber: string,
  reason: string,
): void {
  db.prepare(
    `UPDATE conversations
     SET status = 'human_takeover', handover_reason = ?, last_activity_at = CURRENT_TIMESTAMP
     WHERE phone_number = ?`,
  ).run(reason, phoneNumber);
}

export function checkSessionTimeout(conv: Conversation): boolean {
  const lastActivity = new Date(conv.last_activity_at);
  const now = new Date();
  const hoursSince =
    (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);
  return hoursSince >= 3;
}

export function resetSession(phoneNumber: string): void {
  const conv = getOrCreateConversation(phoneNumber);
  const contextData = JSON.parse(conv.context_data || "{}");

  const preservedContext = {
    lastInterestCategory: contextData.offeredCategory || null,
  };

  db.prepare(
    `UPDATE conversations
     SET current_state = 'INIT',
       context_data = ?,
       status = 'active',
       handover_reason = NULL,
       last_activity_at = CURRENT_TIMESTAMP
     WHERE phone_number = ?`,
  ).run(JSON.stringify(preservedContext), phoneNumber);
}

export function buildStateContext(conv: Conversation): StateContext {
  const contextData = JSON.parse(conv.context_data || "{}");

  return {
    phoneNumber: conv.phone_number,
    dni: conv.dni || undefined,
    clientName: conv.client_name || undefined,
    segment: conv.segment || undefined,
    creditLine: conv.credit_line || undefined,
    nse: conv.nse || undefined,
    isCaliddaClient: conv.is_calidda_client === 1,
    ...contextData,
  };
}

import { getOne, getAll } from "../../db/query.ts";
import type { Conversation } from "@totem/types";
import { WhatsAppService } from "../../services/whatsapp/index.ts";
import { getEventsByPhone } from "../../services/analytics.ts";
import { buildStateContext } from "../chat/context.ts";
import { logAction } from "../../services/audit.ts";
import type { ReplayData, ReplayMetadata } from "@totem/types";

export type Role = "admin" | "developer" | "sales_agent";

export function isValidRole(role: string): role is Role {
  return role === "admin" || role === "developer" || role === "sales_agent";
}

export function listConversations(
  status: string | null | undefined,
  role: Role,
  userId: string,
) {
  if (role === "sales_agent") {
    if (status) {
      return getAll<Conversation>(
        "SELECT * FROM conversations WHERE is_simulation = 0 AND assigned_agent = ? AND status = ? ORDER BY last_activity_at DESC LIMIT 100",
        [userId, status],
      );
    }
    return getAll<Conversation>(
      "SELECT * FROM conversations WHERE is_simulation = 0 AND assigned_agent = ? ORDER BY last_activity_at DESC LIMIT 100",
      [userId],
    );
  }

  if (status) {
    return getAll<Conversation>(
      "SELECT * FROM conversations WHERE is_simulation = 0 AND status = ? ORDER BY last_activity_at DESC LIMIT 100",
      [status],
    );
  }

  return getAll<Conversation>(
    "SELECT * FROM conversations WHERE is_simulation = 0 ORDER BY last_activity_at DESC LIMIT 100",
  );
}

export function getConversationDetail(phoneNumber: string) {
  const conv = getOne<Conversation>(
    "SELECT * FROM conversations WHERE phone_number = ?",
    [phoneNumber],
  );

  if (!conv) {
    return null;
  }

  const messages = WhatsAppService.getMessageHistory(phoneNumber, 100);
  const events = getEventsByPhone(phoneNumber);

  return {
    conversation: conv,
    messages: messages.reverse(),
    events,
  };
}

export function getReplayData(
  phoneNumber: string,
  userId: string,
): ReplayData | null {
  const conv = getOne<Conversation>(
    "SELECT * FROM conversations WHERE phone_number = ?",
    [phoneNumber],
  );

  if (!conv) {
    return null;
  }

  const messages = WhatsAppService.getMessageHistory(phoneNumber, 1000);
  const initialContext = buildStateContext(conv);

  const metadata: ReplayMetadata = {
    conversationId: phoneNumber,
    clientName: conv.client_name,
    segment: conv.segment,
    creditLine: conv.credit_line,
    finalState: conv.current_state,
    messageCount: messages.length,
    timestamp: new Date().toISOString(),
  };

  logAction(userId, "export_replay", "conversation", phoneNumber);

  return {
    conversation: conv,
    messages: messages.reverse(),
    initialContext,
    metadata,
  };
}

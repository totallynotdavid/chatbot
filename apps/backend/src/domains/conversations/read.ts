import { getAll, tenantPredicate } from "../../db/query.ts";
import { refOf } from "../../conversation/store.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import type { Conversation } from "@totem/types";
import { WhatsAppService } from "../../adapters/whatsapp/index.ts";
import { getEventsByConversation } from "../../domains/analytics/index.ts";
import { logAction } from "../../platform/audit/logger.ts";
import type { AuthScope } from "../../platform/auth/scope.ts";
import type { ReplayData, ReplayMetadata } from "@totem/types";

export type Role = "admin" | "developer" | "sales_agent";

/** A null role, held by a member who has not pinned a tenant, is not valid. */
export function isValidRole(role: string | null): role is Role {
  return role === "admin" || role === "developer" || role === "sales_agent";
}

export function listConversations(
  scope: AuthScope,
  status: string | null | undefined,
  role: Role,
) {
  const conditions = ["is_simulation = 0"];
  const params: SQLQueryBindings[] = [];

  // A caller pinned to a tenant sees only that tenant's rows, whatever the role.
  conditions.push(tenantPredicate(scope.tenantId));
  if (scope.tenantId) params.push(scope.tenantId);

  if (role === "sales_agent") {
    conditions.push("assigned_agent = ?");
    params.push(scope.userId);
  }

  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }

  return getAll<Conversation>(
    `SELECT * FROM conversations WHERE ${conditions.join(" AND ")}
     ORDER BY last_activity_at DESC LIMIT 100`,
    params,
  );
}

/**
 * A `:phone` can match two conversations of one tenant, one per WhatsApp
 * number. Picking the latest would splice two threads, so `ambiguous` makes the
 * caller name the channel account.
 */
export type ConversationLookup =
  | { status: "found"; conversation: Conversation }
  | { status: "not_found" }
  | { status: "ambiguous"; candidates: Conversation[] };

/**
 * Resolve a conversation the caller is allowed to see. A caller pinned to a
 * tenant gets another tenant's conversation reported as not found. An unpinned
 * platform operator can find a conversation in any open tenant.
 */
export function lookupConversation(
  scope: AuthScope,
  phoneNumber: string,
  channelAccountId: string | null,
): ConversationLookup {
  const conditions = ["phone_number = ?"];
  const params: SQLQueryBindings[] = [phoneNumber];

  if (!scope.tenantId && !scope.isPlatformOperator) {
    // Neither pinned to a tenant nor platform staff: nothing is visible.
    return { status: "not_found" };
  }

  conditions.push(tenantPredicate(scope.tenantId));
  if (scope.tenantId) params.push(scope.tenantId);

  if (channelAccountId) {
    conditions.push("channel_account_id = ?");
    params.push(channelAccountId);
  }

  const matches = getAll<Conversation>(
    `SELECT * FROM conversations WHERE ${conditions.join(" AND ")}
     ORDER BY last_activity_at DESC`,
    params,
  );

  if (matches.length === 0) {
    return { status: "not_found" };
  }

  if (matches.length > 1) {
    return { status: "ambiguous", candidates: matches };
  }

  return { status: "found", conversation: matches[0]! };
}

export function getConversationDetail(conv: Conversation) {
  const ref = refOf(conv);
  const messages = WhatsAppService.getMessageHistory(ref, 100);
  const events = getEventsByConversation(ref);

  return {
    conversation: conv,
    messages: messages.reverse(),
    events,
  };
}

export function getReplayData(
  conv: Conversation,
  userId: string,
): ReplayData | null {
  const ref = refOf(conv);
  const messages = WhatsAppService.getMessageHistory(ref, 1000);
  const initialContext = JSON.parse(conv.context_data || "{}");

  const metadata: ReplayMetadata = {
    conversationId: conv.phone_number,
    clientName: conv.client_name,
    segment: conv.segment,
    creditLine: conv.credit_line,
    finalState: conv.current_state,
    messageCount: messages.length,
    timestamp: new Date().toISOString(),
  };

  logAction(
    { userId, tenantId: conv.tenant_id },
    "export_replay",
    "conversation",
    conv.phone_number,
  );

  return {
    conversation: conv,
    messages: messages.reverse(),
    initialContext,
    metadata,
  };
}

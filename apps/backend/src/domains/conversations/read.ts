import { getAll, tenantPredicate } from "../../db/query.ts";
import { refOf } from "../../conversation/store.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import type { Conversation } from "@vendeya/types";
import { WhatsAppService } from "../../adapters/whatsapp/index.ts";
import { getEventsByConversation } from "../../domains/analytics/index.ts";
import { logAction } from "../../platform/audit/logger.ts";
import {
  assignedAgentScope,
  type AuthScope,
} from "../../platform/auth/scope.ts";
import type { ReplayData, ReplayMetadata } from "@vendeya/types";

/**
 * A sales agent reaches a conversation assigned to them or to nobody, never one
 * assigned to another agent. Nothing assigns conversations yet, so an agent who
 * follows an escalation alert must still reach the unassigned conversation.
 */
const AGENT_CONVERSATIONS = "(assigned_agent = ? OR assigned_agent IS NULL)";

/**
 * Every tenant role may list conversations. A sales agent sees the ones
 * assigned to them or to nobody, the rule `lookupConversation` applies to one.
 */
export function listConversations(
  scope: AuthScope,
  status: string | null | undefined,
) {
  const conditions = ["is_simulation = 0"];
  const params: SQLQueryBindings[] = [];

  // A caller pinned to a tenant sees only that tenant's rows, whatever the role.
  conditions.push(tenantPredicate(scope.tenantId));
  if (scope.tenantId) params.push(scope.tenantId);

  const agent = assignedAgentScope(scope);
  if (agent) {
    conditions.push(AGENT_CONVERSATIONS);
    params.push(agent);
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
 * tenant gets another tenant's conversation reported as not found, and a sales
 * agent gets one assigned to another agent reported the same way. An unpinned
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

  // A conversation assigned to another agent is not found, like one in another
  // tenant, so every route that resolves `:phone` applies the rule.
  const agent = assignedAgentScope(scope);
  if (agent) {
    conditions.push(AGENT_CONVERSATIONS);
    params.push(agent);
  }

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

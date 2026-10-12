import { db } from "../../db/index.ts";
import {
  activeChannelAccountsOnly,
  getAll,
  getOne,
  openTenantsOnly,
} from "../../db/query.ts";
import {
  ConversationBusyError,
  LockTimeoutError,
  withLock,
} from "../../conversation/locks.ts";
import {
  findConversation,
  updateConversation,
} from "../../conversation/store.ts";
import { createLogger } from "../../lib/logger.ts";
import { eventBus, createEvent } from "../../shared/events/index.ts";
import { TenantSettings } from "../settings/system.ts";
import type { ConversationRef } from "@vendeya/types";

const logger = createLogger("assignment");

type Agent = {
  id: string;
  phone_number: string | null;
};

const AGENT_INDEX_KEY = "last_agent_index";

const ACCEPT_WINDOW_MS = 5 * 60 * 1000;

const ASSIGNED_REASON = "agent_assigned";

const IDENTITY_WHERE =
  "tenant_id = ? AND channel_account_id = ? AND phone_number = ?";

function identityParams(ref: ConversationRef): [string, string, string] {
  return [ref.tenantId, ref.channelAccountId, ref.phoneNumber];
}

/**
 * Assigns the next agent in rotation and notifies them. Takes the conversation
 * lock, so it is for callers that do not hold it: the decline route and the
 * timer. A caller inside the lock, such as an escalating bot turn, uses
 * `assignNextAgentHeld`.
 *
 * @throws ConversationBusyError if the lock does not come free
 * @throws LockTimeoutError if the assignment outlasts the lock timeout
 */
export function assignNextAgent(ref: ConversationRef): Promise<string | null> {
  return withLock(ref, async () => assignNextAgentHeld(ref));
}

/**
 * Round-robin over the agents of one tenant. The caller holds the conversation
 * lock. The conversation ends up escalated, so the bot stays silent, and
 * assigned when an agent is available. Returns null, leaving it escalated and
 * unassigned, when none is.
 */
export function assignNextAgentHeld(ref: ConversationRef): string | null {
  const conversation = findConversation(ref);
  if (!conversation) return null;

  // Whoever gives up a conversation, or a turn that escalates it, is asking for
  // a person. That holds when no agent is free, so the bot must stay silent
  // either way. `updateConversation` sets the status and the reason with the
  // phase. An escalated conversation keeps its own reason.
  if (!isEscalated(conversation.context_data)) {
    updateConversation(
      ref,
      {
        phase: "escalated",
        reason: conversation.handover_reason ?? ASSIGNED_REASON,
      },
      {},
    );
  }

  // Agents are found through membership, so a sales agent in tenant A is never
  // handed tenant B's client. Availability is read from the membership too, so
  // going offline for one business leaves the agent in the other's rotation.
  const agents = getAll<Agent>(
    `SELECT u.id, u.phone_number FROM users u
     JOIN tenant_memberships m ON m.user_id = u.id
     WHERE m.tenant_id = ? AND m.role = 'sales_agent'
       AND m.is_available = 1 AND u.is_active = 1
     ORDER BY u.id`,
    [ref.tenantId],
  );

  if (agents.length === 0) {
    logger.warn({ tenantId: ref.tenantId }, "No available agents");
    return null;
  }

  // The cursor is this module's own state, and the settings route refuses to
  // write it (INTERNAL_TENANT_SETTING_KEYS). It is still read defensively. A
  // non-numeric or negative value falls back to 0. Otherwise the index would
  // be NaN, which survives the modulo and is written back.
  const stored = TenantSettings.get(ref.tenantId, AGENT_INDEX_KEY);
  const parsed = stored === null ? 0 : parseInt(stored, 10);
  const previousIndex = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  const currentIndex = (previousIndex + 1) % agents.length;

  TenantSettings.set(ref.tenantId, AGENT_INDEX_KEY, currentIndex.toString());

  const assignedAgent = agents[currentIndex];

  if (!assignedAgent) {
    logger.warn(
      { tenantId: ref.tenantId, currentIndex, agentCount: agents.length },
      "Failed to get agent from index",
    );
    return null;
  }

  db.prepare(
    `UPDATE conversations
     SET assigned_agent = ?, assignment_notified_at = ?
     WHERE ${IDENTITY_WHERE}`,
  ).run(assignedAgent.id, Date.now(), ...identityParams(ref));

  if (assignedAgent.phone_number) {
    eventBus.emit(
      createEvent(
        "agent_assigned",
        {
          phoneNumber: ref.phoneNumber,
          clientName: conversation.client_name,
          agentId: assignedAgent.id,
          agentPhone: assignedAgent.phone_number,
          dni: conversation.dni,
        },
        { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId },
      ),
    );
  }

  return assignedAgent.id;
}

function isEscalated(contextData: string | null): boolean {
  try {
    return JSON.parse(contextData ?? "{}").phase?.phase === "escalated";
  } catch {
    return false;
  }
}

/**
 * Hands conversations nobody took over to the next agent. An assignment waits
 * for the agent to take the conversation over, which clears
 * `assignment_notified_at`. It runs on a timer across every tenant, so it takes
 * the restriction the scope-driven reads take. A suspended business must not
 * keep churning assignments and notifying agents.
 */
export async function checkAndReassignTimeouts(): Promise<void> {
  const cutoff = Date.now() - ACCEPT_WINDOW_MS;

  // A conversation on a number that is not active is left alone, as the queues
  // leave its messages. Nobody can answer the customer there, so reassigning
  // every five minutes would only page agents for nothing. Its assignment
  // stands until the number is back.
  const timedOutConversations = getAll<{
    tenant_id: string;
    channel_account_id: string;
    phone_number: string;
  }>(
    `SELECT tenant_id, channel_account_id, phone_number
     FROM conversations
     WHERE assignment_notified_at IS NOT NULL
       AND assignment_notified_at < ?
       AND status = 'human_takeover'
       AND ${openTenantsOnly()}
       AND ${activeChannelAccountsOnly()}`,
    [cutoff],
  );

  for (const conv of timedOutConversations) {
    const ref: ConversationRef = {
      tenantId: conv.tenant_id,
      channelAccountId: conv.channel_account_id,
      phoneNumber: conv.phone_number,
    };

    try {
      await withLock(ref, async () => reassignIfStillWaiting(ref, cutoff));
    } catch (error) {
      if (
        error instanceof ConversationBusyError ||
        error instanceof LockTimeoutError
      ) {
        logger.debug(
          { tenantId: ref.tenantId, phoneNumber: ref.phoneNumber },
          "Conversation busy; left the reassignment for later",
        );
        continue;
      }
      logger.error(
        { error, tenantId: ref.tenantId, phoneNumber: ref.phoneNumber },
        "Reassigning a timed-out conversation failed",
      );
    }
  }
}

function reassignIfStillWaiting(ref: ConversationRef, cutoff: number): void {
  const current = getOne<{ assigned_agent: string | null }>(
    `SELECT assigned_agent FROM conversations
     WHERE ${IDENTITY_WHERE}
       AND assignment_notified_at IS NOT NULL
       AND assignment_notified_at < ?
       AND status = 'human_takeover'`,
    [...identityParams(ref), cutoff],
  );
  if (!current) return;

  logger.info(
    {
      tenantId: ref.tenantId,
      phoneNumber: ref.phoneNumber,
      previousAgent: current.assigned_agent,
    },
    "Reassigning timed-out conversation",
  );

  db.prepare(
    `UPDATE conversations
     SET assignment_notified_at = NULL, assigned_agent = NULL
     WHERE ${IDENTITY_WHERE}`,
  ).run(...identityParams(ref));

  assignNextAgentHeld(ref);
}

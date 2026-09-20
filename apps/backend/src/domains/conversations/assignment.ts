import { db } from "../../db/index.ts";
import {
  activeChannelAccountsOnly,
  getAll,
  getOne,
  openTenantsOnly,
} from "../../db/query.ts";
import { createLogger } from "../../lib/logger.ts";
import { eventBus, createEvent } from "../../shared/events/index.ts";
import { TenantSettings } from "../settings/system.ts";
import type { ConversationRef } from "@totem/types";

const logger = createLogger("assignment");

type Agent = {
  id: string;
  name: string;
  phone_number: string | null;
};

const AGENT_INDEX_KEY = "last_agent_index";

/** Round-robin over the agents of one tenant. */
export async function assignNextAgent(
  ref: ConversationRef,
  clientName: string | null,
): Promise<string | null> {
  // Agents are found through membership, so a sales agent in tenant A is never
  // handed tenant B's client. Availability is read from the membership too, so
  // going offline for one business leaves the agent in the other's rotation.
  const agents = getAll<Agent>(
    `SELECT u.id, u.name, u.phone_number FROM users u
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
     SET assigned_agent = ?, assignment_notified_at = ?, status = 'human_takeover'
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
  ).run(
    assignedAgent.id,
    Date.now(),
    ref.tenantId,
    ref.channelAccountId,
    ref.phoneNumber,
  );

  const conversation = getOne<{ dni: string }>(
    `SELECT dni FROM conversations
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
    [ref.tenantId, ref.channelAccountId, ref.phoneNumber],
  );

  if (assignedAgent.phone_number) {
    eventBus.emit(
      createEvent(
        "agent_assigned",
        {
          phoneNumber: ref.phoneNumber,
          clientName,
          agentId: assignedAgent.id,
          agentPhone: assignedAgent.phone_number,
          dni: conversation?.dni,
        },
        { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId },
      ),
    );
  }

  return assignedAgent.id;
}

/**
 * Hands conversations nobody picked up to the next agent. It runs on a timer
 * across every tenant, so it takes the restriction the scope-driven reads take.
 * A suspended business must not keep churning assignments and notifying agents.
 */
export function checkAndReassignTimeouts(): void {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  // A conversation on a number that is not active is left alone, as the queues
  // leave its messages. Nobody can answer the customer there, so reassigning
  // every five minutes would only page agents for nothing. Its assignment
  // stands until the number is back.
  const timedOutConversations = getAll<{
    tenant_id: string;
    channel_account_id: string;
    phone_number: string;
    client_name: string | null;
    assigned_agent: string | null;
  }>(
    `SELECT tenant_id, channel_account_id, phone_number, client_name, assigned_agent
     FROM conversations
     WHERE assignment_notified_at IS NOT NULL
       AND assignment_notified_at < ?
       AND status = 'human_takeover'
       AND handover_reason IS NULL
       AND ${openTenantsOnly()}
       AND ${activeChannelAccountsOnly()}`,
    [fiveMinutesAgo],
  );

  for (const conv of timedOutConversations) {
    const ref: ConversationRef = {
      tenantId: conv.tenant_id,
      channelAccountId: conv.channel_account_id,
      phoneNumber: conv.phone_number,
    };

    logger.info(
      {
        tenantId: ref.tenantId,
        phoneNumber: ref.phoneNumber,
        previousAgent: conv.assigned_agent,
      },
      "Reassigning timed-out conversation",
    );

    db.prepare(
      `UPDATE conversations
       SET assignment_notified_at = NULL, assigned_agent = NULL
       WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
    ).run(ref.tenantId, ref.channelAccountId, ref.phoneNumber);

    assignNextAgent(ref, conv.client_name);
  }
}

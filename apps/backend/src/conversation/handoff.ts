import type { ConversationRef } from "@vendeya/types";
import { assignNextAgentHeld } from "../domains/conversations/assignment.ts";
import { createLogger } from "../lib/logger.ts";
import { createEvent, eventBus } from "../shared/events/index.ts";
import { ConversationBusyError, LockTimeoutError, withLock } from "./locks.ts";
import {
  conversationsWithFailedTurns,
  markTurnsHandedOff,
  unhandedFailedTurns,
} from "./message-inbox.ts";
import {
  cancelPending,
  conversationsAwaitingHandoff,
  markHandedOff,
  undeliveredRows,
} from "./outbox.ts";
import { escalateConversation, findConversation } from "./store.ts";
import { raiseUnreadAlert } from "./unread-alerts.ts";

/*
 * Failed outbox and inbox rows use the same handoff. The lock protects
 * cancellation, escalation, assignment, alerting, and stamping. A crash
 * before stamping can alert twice.
 */

const logger = createLogger("handoff");

export const REPLY_UNDELIVERABLE = "reply_undeliverable";
export const TURN_FAILED = "turn_failed";

/**
 * Hands off each conversation of an open tenant that owns an unstamped failed
 * row. A conversation whose lock stays busy is left for the next pass.
 * Conversations run in parallel and each inside its own lock, and one that
 * throws does not stop the others.
 */
export async function handOffUndeliverable(at: () => number): Promise<void> {
  const refs = new Map<string, ConversationRef>();
  for (const ref of [
    ...conversationsAwaitingHandoff(),
    ...conversationsWithFailedTurns(),
  ]) {
    refs.set(`${ref.tenantId}:${ref.channelAccountId}:${ref.phoneNumber}`, ref);
  }

  await Promise.all([...refs.values()].map((ref) => handOff(ref, at)));
}

async function handOff(ref: ConversationRef, at: () => number): Promise<void> {
  // Keep the ids outside the lock so late failures can identify the rows.
  let outboxIds: number[] = [];
  let inboxIds: number[] = [];

  try {
    await withLock(ref, async () => {
      const replies = undeliveredRows(ref);
      const turns = unhandedFailedTurns(ref);
      if (replies.length === 0 && turns.length === 0) return;
      outboxIds = replies.map((row) => row.id);
      inboxIds = turns.map((row) => row.id);

      // A failed turn takes precedence because the customer's message was
      // never answered, regardless of any outbox failure.
      const reason = turns.length > 0 ? TURN_FAILED : REPLY_UNDELIVERABLE;
      const lastReason =
        turns.length > 0
          ? turns[turns.length - 1]!.last_error
          : replies[replies.length - 1]!.last_reason;

      const cancelledReplies = cancelPending(ref);

      // A conversation the bot escalated or a person took over keeps its state
      // and reason. It still gets the alert, because the advisor message the
      // bot queued may be the reply that failed.
      const statusBefore = findConversation(ref)?.status;
      if (statusBefore === "active") {
        escalateConversation(ref, reason);
        assignNextAgentHeld(ref);
      }

      raiseUnreadAlert(ref);
      await eventBus.emit(
        createEvent(
          "escalation_triggered",
          {
            phoneNumber: ref.phoneNumber,
            reason,
            context: {
              failedReplies: replies.length,
              failedTurns: turns.length,
              lastReason,
            },
          },
          { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId },
        ),
      );

      markHandedOff(outboxIds, at());
      markTurnsHandedOff(inboxIds, at());

      logger.info(
        {
          tenantId: ref.tenantId,
          channelAccountId: ref.channelAccountId,
          outboxIds,
          inboxIds,
          reason,
          cancelledReplies,
          statusBefore,
          statusAfter: findConversation(ref)?.status,
        },
        "Handed a conversation to a person because the customer got no answer",
      );
    });
  } catch (error) {
    if (error instanceof ConversationBusyError) {
      // Nothing ran, so the rows stay unstamped and the next pass tries again.
      logger.debug(
        { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId },
        "Conversation still busy; left the handoff for later",
      );
      return;
    }

    if (error instanceof LockTimeoutError) {
      // The handoff still holds the lock and stamps its own rows. A failure
      // after this point is logged here because no caller is left to see it.
      logger.warn(
        { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId },
        "Lock timed out during a handoff; it is still running",
      );
      error.operation.catch((late) =>
        logger.error(
          {
            error: late,
            tenantId: ref.tenantId,
            channelAccountId: ref.channelAccountId,
            outboxIds,
            inboxIds,
          },
          "Handoff failed after its lock timed out",
        ),
      );
      return;
    }

    logger.error(
      {
        error,
        tenantId: ref.tenantId,
        channelAccountId: ref.channelAccountId,
        outboxIds,
        inboxIds,
      },
      "Handoff failed for a conversation",
    );
  }
}

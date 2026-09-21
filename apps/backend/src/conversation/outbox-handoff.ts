import type { ConversationRef } from "@totem/types";
import { createLogger } from "../lib/logger.ts";
import { createEvent, eventBus } from "../shared/events/index.ts";
import { ConversationBusyError, LockTimeoutError, withLock } from "./locks.ts";
import {
  cancelPending,
  conversationsAwaitingHandoff,
  markHandedOff,
  undeliveredRows,
} from "./outbox.ts";
import { escalateConversation, findConversation } from "./store.ts";

/*
 * A reply that ended `failed` left the customer without an answer, so the
 * conversation goes to a person. The handoff finds its work by state: a
 * conversation with a `failed` row whose `handed_off_at` is NULL. It is not
 * called from the code that fails a row. That covers every route to `failed`
 * (a recorded outcome, expiry, boot recovery) and a crash between the failure
 * and the handoff.
 *
 * Inside the conversation lock, in this order:
 *  1. Read the failed rows that are not handed off. None means return.
 *  2. Cancel the conversation's pending rows.
 *  3. Escalate the conversation if it is `active`.
 *  4. Emit `escalation_triggered`.
 *  5. Stamp `handed_off_at` on the rows read in step 1.
 *
 * The alert is emitted before the stamp, on purpose. A crash between the two
 * leaves the rows unstamped, so the next pass hands off again and the advisor
 * gets a second alert. A duplicate alert costs one message. A missed one leaves
 * a customer waiting with nobody told. Steps 2 and 3 are idempotent, so a
 * repeated pass is safe.
 */

const logger = createLogger("outbox-handoff");

export const REPLY_UNDELIVERABLE = "reply_undeliverable";

/**
 * Hands off each conversation of an open tenant that owns an unstamped failed
 * row. A conversation whose lock stays busy is left for the next pass.
 * Conversations run in parallel and each inside its own lock, and one that
 * throws does not stop the others.
 */
export async function handOffUndeliverable(at: () => number): Promise<void> {
  const refs = conversationsAwaitingHandoff();
  await Promise.all(refs.map((ref) => handOff(ref, at)));
}

async function handOff(ref: ConversationRef, at: () => number): Promise<void> {
  // Named in the error logs below, so an operator can find the rows.
  let outboxIds: number[] = [];

  try {
    await withLock(ref, async () => {
      const rows = undeliveredRows(ref);
      if (rows.length === 0) return;
      outboxIds = rows.map((row) => row.id);

      const cancelledReplies = cancelPending(ref);

      // A conversation the bot escalated or a person took over keeps its state
      // and reason. It still gets the alert, because the advisor message the
      // bot queued may be the reply that failed.
      const statusBefore = findConversation(ref)?.status;
      if (statusBefore === "active") {
        escalateConversation(ref, REPLY_UNDELIVERABLE);
      }

      await eventBus.emit(
        createEvent(
          "escalation_triggered",
          {
            phoneNumber: ref.phoneNumber,
            reason: REPLY_UNDELIVERABLE,
            context: {
              failedReplies: rows.length,
              lastReason: rows[rows.length - 1]!.last_reason,
            },
          },
          { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId },
        ),
      );

      markHandedOff(outboxIds, at());

      logger.info(
        {
          tenantId: ref.tenantId,
          channelAccountId: ref.channelAccountId,
          outboxIds,
          failedReplies: rows.length,
          cancelledReplies,
          statusBefore,
          statusAfter: findConversation(ref)?.status,
        },
        "Handed a conversation to a person because a reply could not be delivered",
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
      },
      "Handoff failed for a conversation",
    );
  }
}

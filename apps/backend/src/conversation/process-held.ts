import {
  claimHeldMessages,
  getAggregatedHeldMessages,
  markHeldAsProcessed,
  releaseHeldMessages,
} from "./held-messages.ts";
import { handleMessage } from "./handler/index.ts";
import { LockTimeoutError } from "./locks.ts";
import { ChannelUnavailableError } from "../adapters/whatsapp/index.ts";
import { isMaintenanceMode } from "../domains/settings/system.ts";
import { createLogger } from "../lib/logger.ts";
import type { ConversationRef } from "@vendeya/types";

const logger = createLogger("held-messages");

export type HeldMessageStats = {
  usersProcessed: number;
  messagesProcessed: number;
  errors: number;
  /**
   * Conversations whose answer outlasted the lock timeout. They are recorded
   * when that answer settles, which may be after the sweep has returned.
   */
  stillAnswering: number;
};

export type HeldMessageRun = HeldMessageStats & {
  /**
   * The same counts split by tenant. The audit trail is written from this
   * split, because a platform sweep across all tenants has to leave a record
   * in each tenant it reached.
   */
  byTenant: Record<string, HeldMessageStats>;
  /**
   * Tenants whose messages were left held because maintenance mode is on for
   * them, by their own setting or the platform's. A platform sweep skips them
   * one by one instead of being refused, so one tenant's freeze does not block
   * recovery for the others.
   */
  frozenTenants: string[];
};

const NO_WORK: HeldMessageStats = {
  usersProcessed: 0,
  messagesProcessed: 0,
  errors: 0,
  stillAnswering: 0,
};

/**
 * Answers the messages held during maintenance mode, except a frozen tenant's.
 * `tenantId` null spans every open tenant, which is the platform-wide recovery
 * case.
 */
export async function processHeldMessages(
  tenantId: string | null = null,
): Promise<HeldMessageRun> {
  const aggregatedGroups = getAggregatedHeldMessages(tenantId);

  if (aggregatedGroups.length === 0) {
    logger.debug("No held messages");
    return { ...NO_WORK, byTenant: {}, frozenTenants: [] };
  }

  logger.debug(
    { count: aggregatedGroups.length },
    "Processing held messages from users",
  );

  const byTenant: Record<string, HeldMessageStats> = {};
  const frozen = new Set<string>();

  /**
   * A tenant's entry, created by the first outcome recorded in it. A group that
   * is skipped records no outcome, because an entry becomes an audit row saying
   * the sweep acted in that tenant.
   */
  const statsFor = (tenantId: string): HeldMessageStats => {
    byTenant[tenantId] ??= { ...NO_WORK };
    return byTenant[tenantId];
  };

  for (const group of aggregatedGroups) {
    const ref = {
      tenantId: group.tenant_id,
      channelAccountId: group.channel_account_id,
      phoneNumber: group.phone_number,
    };

    // Maintenance mode promises that nothing goes out while it is on, and
    // `handleMessage` replies to the customer. A frozen tenant's messages
    // therefore stay held and unprocessed. They are not counted or marked
    // processed, so the run can be repeated after the freeze lifts.
    if (isMaintenanceMode(ref.tenantId)) {
      frozen.add(ref.tenantId);
      continue;
    }

    const ids = group.message_ids.split(",").map((id) => parseInt(id, 10));

    // The groups were read before the loop reached this one. Another sweep may
    // have claimed it since, or may still be answering it after a lock timeout.
    if (!claimHeldMessages(ref.tenantId, ids)) {
      logger.debug(
        {
          tenantId: ref.tenantId,
          phoneNumber: ref.phoneNumber,
          messageIds: ids,
        },
        "Held messages already taken by another sweep",
      );
      continue;
    }

    logger.debug(
      {
        tenantId: ref.tenantId,
        phoneNumber: ref.phoneNumber,
        count: group.message_count,
      },
      "Processing held messages for user",
    );

    try {
      await handleMessage({
        ref,
        content: group.aggregated_text,
        timestamp: group.oldest_timestamp,
        messageId: group.latest_message_id,
      });
    } catch (error) {
      if (error instanceof LockTimeoutError) {
        statsFor(ref.tenantId).stillAnswering++;
        recordLateOutcome(ids, ref, error);
        continue;
      }

      releaseHeldMessages(ids);

      if (error instanceof ChannelUnavailableError) {
        // The number was switched off between the read above and the send.
        // Treated like the maintenance skip: not counted, and the sweep can be
        // run again once the number is back with nothing lost.
        logger.warn(
          {
            tenantId: ref.tenantId,
            channelAccountId: ref.channelAccountId,
            phoneNumber: ref.phoneNumber,
            status: error.status,
          },
          "Channel account is not active; left these messages held",
        );
        continue;
      }

      statsFor(ref.tenantId).errors++;
      logger.error(
        { error, tenantId: ref.tenantId, phoneNumber: ref.phoneNumber },
        "Failed to process held messages for user",
      );
      continue;
    }

    markHeldAsProcessed(ids);
    const stats = statsFor(ref.tenantId);
    stats.usersProcessed++;
    stats.messagesProcessed += ids.length;
    logger.debug(
      { tenantId: ref.tenantId, phoneNumber: ref.phoneNumber, messageIds: ids },
      "Processed held messages for user",
    );
  }

  const result: HeldMessageRun = {
    ...Object.values(byTenant).reduce(
      (totals, stats) => ({
        usersProcessed: totals.usersProcessed + stats.usersProcessed,
        messagesProcessed: totals.messagesProcessed + stats.messagesProcessed,
        errors: totals.errors + stats.errors,
        stillAnswering: totals.stillAnswering + stats.stillAnswering,
      }),
      NO_WORK,
    ),
    byTenant,
    frozenTenants: [...frozen],
  };

  logger.debug(result, "Held messages processed");

  return result;
}

/**
 * The answer is still running, so the group stays claimed until it settles.
 * Releasing it now would let the next sweep answer the group again while this
 * answer may still reply.
 */
function recordLateOutcome(
  ids: number[],
  ref: ConversationRef,
  timeout: LockTimeoutError,
): void {
  logger.warn(
    { tenantId: ref.tenantId, phoneNumber: ref.phoneNumber, messageIds: ids },
    "Lock timed out while answering held messages; they stay claimed until the answer settles",
  );

  timeout.operation
    .then(
      () => markHeldAsProcessed(ids),
      (error: unknown) => {
        releaseHeldMessages(ids);
        logger.warn(
          { error, tenantId: ref.tenantId, phoneNumber: ref.phoneNumber },
          "Timed-out answer to held messages failed; left them held",
        );
      },
    )
    .catch((error: unknown) => {
      logger.error(
        { error, tenantId: ref.tenantId, messageIds: ids },
        "Failed to record the outcome of a timed-out answer",
      );
    });
}

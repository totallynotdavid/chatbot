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
import type { ConversationRef } from "@totem/types";

const logger = createLogger("held-messages");

export type HeldMessageStats = {
  usersProcessed: number;
  messagesProcessed: number;
  errors: number;
  /**
   * Conversations whose answer outlasted the lock timeout. They were still
   * being answered when the sweep returned, and are recorded when that answer
   * settles - after this count was reported.
   */
  stillAnswering: number;
};

/**
 * The totals, plus the same counts split by tenant.
 *
 * A pinned caller sweeps one tenant and `byTenant` holds that one entry; a
 * platform operator with no tenant selected sweeps every open tenant at once,
 * and the totals alone say nothing about which businesses were touched or what
 * happened in each. The audit trail is written from the split (see
 * routes/admin/operations.ts), so a cross-tenant run leaves a record in every
 * tenant it actually reached. A tenant appears here once a group of its held
 * messages went through, failed, or was still being answered when the sweep
 * returned - not when every group it had was skipped, whether for its own
 * freeze, for a number switched off mid-sweep, or for another sweep already
 * answering it, because an entry here becomes an audit row saying the sweep
 * acted in that business.
 */
export type HeldMessageRun = HeldMessageStats & {
  byTenant: Record<string, HeldMessageStats>;
  /**
   * Tenants whose messages were left held because their own freeze is on.
   *
   * A pinned caller is refused outright by the route, but a platform operator
   * with no tenant selected sweeps every open tenant at once - and among them
   * may be a business that put *itself* into maintenance. Refusing the whole
   * sweep for one of those would make a single tenant's freeze block recovery
   * for everybody, so they are skipped individually and named here instead.
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
 * Process all held messages from maintenance mode. `tenantId` null spans every
 * open tenant, which is the platform-wide recovery case.
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

  /** A tenant's entry, created by the first outcome actually recorded in it. */
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

    // Maintenance mode makes exactly one promise - nothing goes out while it is
    // on - and this loop is a sending loop: `handleMessage` runs the bot and
    // replies to the customer. So a frozen tenant's messages stay held, and
    // stay held *unprocessed*: they are not counted, not marked processed, and
    // the run can be triggered again once the freeze lifts with nothing lost.
    if (isMaintenanceMode(ref.tenantId)) {
      frozen.add(ref.tenantId);
      continue;
    }

    const ids = group.message_ids.split(",").map((id) => parseInt(id, 10));

    // Read before the loop reached it, so another sweep may have taken it
    // since - or, after its own lock timeout, still be answering it.
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
 * The answer is still running, and the group stays claimed until it settles:
 * released now, the next sweep would answer it again while this answer may
 * still reply.
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

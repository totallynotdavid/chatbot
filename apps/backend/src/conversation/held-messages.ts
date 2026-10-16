import { db } from "../db/index.ts";
import {
  activeChannelAccountsOnly,
  getAll,
  getOne,
  tenantPredicate,
} from "../db/query.ts";
import { createLogger } from "../lib/logger.ts";
import { MAX_TURN_ATTEMPTS, storeFailedTurn } from "./message-inbox.ts";
import type { ConversationRef } from "@vendeya/types";

const logger = createLogger("held-messages");

/*
 * The states of a held message, and who moves each one.
 *
 *  - held: `processed_at` is null and the row is not claimed. The webhook stores
 *    it (`holdMessage`). Only a sweep takes it out, with `claimHeldMessages`,
 *    right before it answers the group.
 *  - answering: `processed_at` is null and the id is in `answering` below. A
 *    claim is refused while any row of the group is answering or already
 *    answered, so two sweeps in this process never answer one group. Only the
 *    sweep that claimed the row moves it on, and only once `handleMessage` has
 *    settled. After a `LockTimeoutError` the sweep returns first and the answer
 *    settles later.
 *    The row goes to:
 *      - answered (`markHeldAsProcessed`) when the reply was handled.
 *      - held (`releaseHeldMessages`) when answering threw, so a later sweep
 *        answers it. A group that throws a second time is handed to a person
 *        instead (`recordFailedHeldTurn`).
 *  - answered: `processed_at` is set. `isHeld` counts it until
 *    `purgeProcessedHeldMessages` removes it.
 */

// `answering` lives in memory because it stands for an answer running in this
// process, the same thing the conversation lock stands for. A restart ends
// every such answer and its rows are held again. A reply that went out just
// before the process died is sent again by the next sweep.
const answering = new Set<number>();

// Failed turns of a held row, by id. It lives in memory for the same reason: a
// restart is a fresh start for a sweep an operator runs by hand.
const failedTurns = new Map<number, number>();

type AggregatedHeldGroup = {
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  message_ids: string;
  aggregated_text: string;
  oldest_timestamp: number;
  latest_message_id: string;
  message_count: number;
};

/**
 * Whether this Meta message id was held for maintenance, whether or not it has
 * been answered since. An answered row still counts until
 * `purgeProcessedHeldMessages` removes it.
 */
export function isHeld(messageId: string): boolean {
  const row = getOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM held_messages WHERE message_id = ?",
    [messageId],
  );

  return (row?.count ?? 0) > 0;
}

/**
 * Store a message received during maintenance mode. A redelivery of the same
 * Meta message id is ignored.
 */
export function holdMessage(
  ref: ConversationRef,
  text: string,
  messageId: string,
  whatsappTimestamp: number,
): void {
  db.prepare(
    `INSERT INTO held_messages (tenant_id, channel_account_id, phone_number, message_text, message_id, whatsapp_timestamp)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO NOTHING`,
  ).run(
    ref.tenantId,
    ref.channelAccountId,
    ref.phoneNumber,
    text,
    messageId,
    whatsappTimestamp,
  );

  logger.debug(
    {
      tenantId: ref.tenantId,
      phoneNumber: ref.phoneNumber,
      messageId,
      whatsappTimestamp,
    },
    "Message held",
  );
}

/**
 * Held messages not yet answered, aggregated by conversation. `tenantId` null
 * spans open tenants, for platform-wide maintenance recovery. Groups on a
 * `pending` or `disabled` channel account are left out, because a send on such
 * an account is refused. Those rows stay held until the number is active.
 */
export function getAggregatedHeldMessages(
  tenantId: string | null = null,
): AggregatedHeldGroup[] {
  return getAll<AggregatedHeldGroup>(
    `SELECT
       tenant_id,
       channel_account_id,
       phone_number,
       GROUP_CONCAT(id) as message_ids,
       GROUP_CONCAT(message_text, ' ') as aggregated_text,
       MIN(whatsapp_timestamp) as oldest_timestamp,
       MAX(message_id) as latest_message_id,
       COUNT(*) as message_count
     FROM held_messages
     WHERE processed_at IS NULL
       AND ${tenantPredicate(tenantId)}
       AND ${activeChannelAccountsOnly()}
     GROUP BY tenant_id, channel_account_id, phone_number
     ORDER BY MIN(created_at) ASC`,
    tenantId ? [tenantId] : [],
  );
}

/**
 * Take a group for answering. False when another sweep is answering any of it,
 * or has already answered any of it since the group was read.
 */
export function claimHeldMessages(tenantId: string, ids: number[]): boolean {
  if (ids.some((id) => answering.has(id))) return false;

  const placeholders = ids.map(() => "?").join(",");
  const unanswered = getOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM held_messages
     WHERE tenant_id = ? AND processed_at IS NULL AND id IN (${placeholders})`,
    [tenantId, ...ids],
  );
  if ((unanswered?.count ?? 0) !== ids.length) return false;

  for (const id of ids) answering.add(id);
  return true;
}

/** Give a claimed group back unanswered. */
export function releaseHeldMessages(ids: number[]): void {
  for (const id of ids) answering.delete(id);
}

/**
 * Counts a claimed group whose turn threw, per group and in memory. Until the
 * last attempt it is released for the next sweep. Then its messages move to the
 * inbox as `failed` rows for the handoff, and the held rows count as answered.
 * Returns whether it handed the group off.
 */
export function recordFailedHeldTurn(
  ref: ConversationRef,
  ids: number[],
  error: string,
): boolean {
  const attempts = Math.max(...ids.map((id) => failedTurns.get(id) ?? 0)) + 1;

  if (attempts < MAX_TURN_ATTEMPTS) {
    for (const id of ids) failedTurns.set(id, attempts);
    releaseHeldMessages(ids);
    return false;
  }

  // The conversation's rows at this moment, not only the claimed ones: a
  // message held while the turn ran must not be answered after the handoff.
  db.transaction(() => {
    const rows = getAll<{
      id: number;
      message_id: string;
      message_text: string;
      whatsapp_timestamp: number;
    }>(
      `SELECT id, message_id, message_text, whatsapp_timestamp FROM held_messages
       WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
         AND processed_at IS NULL`,
      [ref.tenantId, ref.channelAccountId, ref.phoneNumber],
    );
    for (const row of rows) {
      storeFailedTurn(
        ref,
        {
          id: row.message_id,
          body: row.message_text,
          timestamp: row.whatsapp_timestamp,
        },
        error,
      );
    }
    markHeldAsProcessed([...new Set([...ids, ...rows.map((row) => row.id)])]);
  })();
  return true;
}

/** Record a claimed group as answered, and end the claim. */
export function markHeldAsProcessed(ids: number[]): void {
  if (ids.length === 0) return;

  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `UPDATE held_messages SET processed_at = ? WHERE id IN (${placeholders})`,
  ).run(Date.now(), ...ids);
  releaseHeldMessages(ids);
  for (const id of ids) failedTurns.delete(id);

  logger.debug({ count: ids.length }, "Marked held messages processed");
}

/** Delete answered held messages processed before `before` (epoch ms). */
export function purgeProcessedHeldMessages(before: number): number {
  return db
    .prepare(
      "DELETE FROM held_messages WHERE processed_at IS NOT NULL AND processed_at < ?",
    )
    .run(before).changes;
}

/** Held messages still waiting to be answered. */
export function countHeldMessages(tenantId: string | null = null): number {
  const rows = getAll<{ count: number }>(
    `SELECT COUNT(*) as count FROM held_messages
     WHERE processed_at IS NULL AND ${tenantPredicate(tenantId)}`,
    tenantId ? [tenantId] : [],
  );
  return rows[0]?.count ?? 0;
}

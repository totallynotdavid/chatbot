import { db } from "../db/index.ts";
import {
  activeChannelAccountsOnly,
  getAll,
  getOne,
  openTenantsOnly,
  tenantPredicate,
} from "../db/query.ts";
import type { ConversationRef, IncomingMessage } from "@totem/types";

/*
 * The statuses of an inbox row, and who moves each one.
 *
 *  - pending: stored by the webhook (`storeIncomingMessage`). Only the
 *    aggregator worker takes it out, with `markAsProcessing`, straight after
 *    `getReadyForAggregation` hands it the group.
 *  - processing: a reply to the group is being worked out and sent. Only the
 *    worker that took the group moves it on, and only once `handleMessage` has
 *    settled - which, after a `LockTimeoutError`, is some time after the worker
 *    was told it ran out of time. It goes to
 *      - processed, when the reply was handled;
 *      - pending, when no reply went out and one is still owed: the
 *        conversation was busy, or the number was switched off;
 *      - failed, when answering threw anything else.
 *    A process that dies here leaves the row processing: whether the customer
 *    already got a reply is not known, so it is not answered again.
 *  - processed: kept for `isQueued` until `purgeProcessedInbox`.
 *  - failed: stays failed, with `last_error`, until `retryFailed` puts it back
 *    to pending.
 */

type InboxMessage = {
  id: number;
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  message_text: string;
  message_id: string;
  whatsapp_timestamp: number;
  status: "pending" | "processing" | "processed" | "failed";
  aggregate_id: string | null;
  attempts: number;
  last_error: string | null;
  created_at: number;
  processed_at: number | null;
};

/**
 * Aggregation groups by the full conversation identity, so two tenants that
 * happen to be messaged by the same contact number are never merged into one
 * batch.
 */
export type AggregatedGroup = {
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  ids: string;
  aggregated_text: string;
  oldest_timestamp: number;
  latest_message_id: string;
  quoted_message_context: string | null;
};

/** Whether this Meta message id is already on the queue, processed or not. */
export function isQueued(messageId: string): boolean {
  const row = getOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM message_inbox WHERE message_id = ?",
    [messageId],
  );

  return (row?.count ?? 0) > 0;
}

/**
 * Queue an inbound message for aggregation. The Meta message id is unique, so a
 * redelivery of the same message is ignored rather than raising - Meta resends
 * a whole batch whenever any part of it failed.
 */
export function storeIncomingMessage(
  ref: ConversationRef,
  message: IncomingMessage,
): void {
  const now = Date.now();
  const quotedContextJson = message.quotedContext
    ? JSON.stringify(message.quotedContext)
    : null;

  db.prepare(
    `INSERT INTO message_inbox (tenant_id, channel_account_id, phone_number, message_text, message_id, whatsapp_timestamp, created_at, quoted_message_context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO NOTHING`,
  ).run(
    ref.tenantId,
    ref.channelAccountId,
    ref.phoneNumber,
    message.body,
    message.id,
    message.timestamp,
    now,
    quotedContextJson,
  );
}

/**
 * The groups the aggregator worker is allowed to answer.
 *
 * Suspension has to stop work already in flight, not just new inbound. A
 * message queued a minute before a business was closed is still sitting here
 * pending, and processing it sends the customer a reply on behalf of an
 * account that has been cut off - `webhook.ts` refusing new messages does
 * nothing about the ones already queued. Restricting the dequeue leaves those
 * rows pending rather than dropping them, so reactivating the tenant resumes
 * where it left off.
 *
 * The number the reply would go out on has to be open too, and for the same
 * reason. Answering on an account that is `pending` or `disabled` gets the send
 * refused, and the refusal was silent: the reply was recorded as failed and the
 * worker marked the row processed regardless, so switching a number off threw
 * away every message already queued for it with nothing left to recover. Both
 * halves of the conversation's identity are therefore checked here, and both
 * leave the row pending.
 */
export function getReadyForAggregation(
  quietWindowMs: number,
): AggregatedGroup[] {
  const cutoffTime = Date.now() - quietWindowMs;

  const groups = getAll<AggregatedGroup>(
    `SELECT
       tenant_id,
       channel_account_id,
       phone_number,
       GROUP_CONCAT(id) as ids,
       GROUP_CONCAT(message_text, ' ') as aggregated_text,
       MIN(whatsapp_timestamp) as oldest_timestamp,
       MAX(message_id) as latest_message_id,
       MAX(quoted_message_context) as quoted_message_context
     FROM message_inbox
     WHERE status = 'pending'
       AND created_at < ?
       AND ${openTenantsOnly()}
       AND ${activeChannelAccountsOnly()}
     GROUP BY tenant_id, channel_account_id, phone_number`,
    [cutoffTime],
  );

  return groups;
}

/**
 * Mark messages as processing (prevents double-processing)
 */
export function markAsProcessing(ids: string): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");

  db.prepare(
    `UPDATE message_inbox SET status = 'processing' WHERE id IN (${placeholders})`,
  ).run(...idList);
}

/** Put a group that was never answered back on the queue. */
export function markAsPending(ids: string): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");

  db.prepare(
    `UPDATE message_inbox SET status = 'pending' WHERE id IN (${placeholders})`,
  ).run(...idList);
}

export function markAsProcessed(ids: string): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");

  db.prepare(
    `UPDATE message_inbox
     SET status = 'processed', processed_at = ?
     WHERE id IN (${placeholders})`,
  ).run(Date.now(), ...idList);
}

export function markAsFailed(ids: string, error: string): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");

  db.prepare(
    `UPDATE message_inbox
     SET status = 'failed', attempts = attempts + 1, last_error = ?
     WHERE id IN (${placeholders})`,
  ).run(error, ...idList);
}

/**
 * Queue depth. `tenantId` null counts across tenants, which only platform
 * operators ever ask for.
 */
export function countPending(tenantId: string | null = null): number {
  const rows = getAll<{ count: number }>(
    `SELECT COUNT(*) as count FROM message_inbox
     WHERE status = 'pending' AND ${tenantPredicate(tenantId)}`,
    tenantId ? [tenantId] : [],
  );
  return rows[0]?.count ?? 0;
}

export function countFailed(tenantId: string | null = null): number {
  const rows = getAll<{ count: number }>(
    `SELECT COUNT(*) as count FROM message_inbox
     WHERE status = 'failed' AND ${tenantPredicate(tenantId)}`,
    tenantId ? [tenantId] : [],
  );
  return rows[0]?.count ?? 0;
}

export function getFailedMessages(
  tenantId: string | null = null,
  limit = 100,
): InboxMessage[] {
  return getAll<InboxMessage>(
    `SELECT * FROM message_inbox
     WHERE status = 'failed' AND ${tenantPredicate(tenantId)}
     ORDER BY created_at DESC LIMIT ?`,
    tenantId ? [tenantId, limit] : [limit],
  );
}

export function retryFailed(
  tenantId: string | null = null,
  maxAttempts = 3,
): number {
  const result = db
    .prepare(
      `UPDATE message_inbox SET status = 'pending', last_error = NULL
       WHERE status = 'failed' AND attempts < ? AND ${tenantPredicate(tenantId)}`,
    )
    .run(...(tenantId ? [maxAttempts, tenantId] : [maxAttempts]));

  return result.changes;
}

/** Delete processed inbox rows processed before `before` (epoch ms). */
export function purgeProcessedInbox(before: number): number {
  return db
    .prepare(
      "DELETE FROM message_inbox WHERE status = 'processed' AND processed_at < ?",
    )
    .run(before).changes;
}

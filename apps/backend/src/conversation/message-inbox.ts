import { db } from "../db/index.ts";
import {
  activeChannelAccountsOnly,
  getAll,
  getOne,
  openTenantsOnly,
  tenantPredicate,
} from "../db/query.ts";
import type { ConversationRef, IncomingMessage } from "@vendeya/types";

/*
 * A row is processed with the transaction that persists its turn, or failed
 * after `MAX_TURN_ATTEMPTS`. Throws and dead processes count attempts. A busy
 * lock does not. `handoff.ts` alerts for an unstamped failure.
 */

/** Turns a group gets before it is handed to a person. */
export const MAX_TURN_ATTEMPTS = 2;

/** The `last_error` of a row whose turn died with the process. */
export const INTERRUPTED_TURN = "interrupted: the process ended mid-turn";

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
  /** The most failed turns any row of the group has had. */
  attempts: number;
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
 * redelivery of the same message is ignored rather than raising. Meta resends a
 * whole batch when the webhook answers 5xx.
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
 * The groups the aggregator worker is allowed to answer. A group whose tenant
 * is suspended or whose channel account is not active stays pending, so
 * reactivating either resumes it.
 */
export function getReadyForAggregation(
  quietWindowMs: number,
): AggregatedGroup[] {
  const cutoffTime = Date.now() - quietWindowMs;

  // Suspension must also stop messages queued before it. `webhook.ts` refuses
  // only new inbound.
  // A send on a `pending` or `disabled` account is refused, so its rows must
  // stay pending instead of being answered.
  const groups = getAll<AggregatedGroup>(
    `SELECT
       tenant_id,
       channel_account_id,
       phone_number,
       GROUP_CONCAT(id) as ids,
       GROUP_CONCAT(message_text, ' ') as aggregated_text,
       MIN(whatsapp_timestamp) as oldest_timestamp,
       MAX(message_id) as latest_message_id,
       MAX(quoted_message_context) as quoted_message_context,
       MAX(attempts) as attempts
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

/** Takes the group out of the ready set, so no poll answers it twice. */
export function markAsProcessing(ids: string): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");

  db.prepare(
    `UPDATE message_inbox SET status = 'processing' WHERE id IN (${placeholders})`,
  ).run(...idList);
}

/** Put a group whose reply is still owed back on the queue. */
export function markAsPending(ids: string): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");

  db.prepare(
    `UPDATE message_inbox SET status = 'pending' WHERE id IN (${placeholders})`,
  ).run(...idList);
}

/**
 * Settles the rows of a turn that sent its reply, inside the transaction that
 * persists the turn. It is the only way a row becomes `processed`.
 */
export function markAsProcessed(ids: string): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");

  db.prepare(
    `UPDATE message_inbox
     SET status = 'processed', processed_at = ?
     WHERE id IN (${placeholders})`,
  ).run(Date.now(), ...idList);
}

/**
 * Counts a turn that ended without a reply. Attempts belong to the
 * conversation, not the row: `groupAttempts` is the most any row of the group
 * had when it was read. On the last attempt the statement also fails every
 * `pending` row that arrived while the turn ran, so none is answered after the
 * handoff.
 */
export function recordFailedTurn(
  ref: ConversationRef,
  ids: string,
  groupAttempts: number,
  error: string,
): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");
  const attempts = groupAttempts + 1;
  const last = attempts >= MAX_TURN_ATTEMPTS;

  db.prepare(
    `UPDATE message_inbox
     SET attempts = ?,
         last_error = ?,
         status = ?
     WHERE (id IN (${placeholders}) AND status = 'processing')
        OR (? AND status = 'pending'
            AND tenant_id = ? AND channel_account_id = ? AND phone_number = ?)`,
  ).run(
    attempts,
    error,
    last ? "failed" : "pending",
    ...idList,
    last ? 1 : 0,
    ref.tenantId,
    ref.channelAccountId,
    ref.phoneNumber,
  );
}

/**
 * Settles the rows a dead process left `processing`, in every tenant. It runs
 * before the aggregator starts, so no turn is alive. The dead turn counts as
 * one attempt for each conversation, on its rows' highest count. When that is
 * the last attempt, the conversation's `pending` rows fail with it.
 */
export function recoverInterruptedTurns(): number {
  return db
    .prepare(
      `UPDATE message_inbox
       SET attempts = turn.attempts,
           last_error = ?,
           status = CASE WHEN turn.attempts >= ? THEN 'failed' ELSE 'pending' END
       FROM (
         SELECT tenant_id, channel_account_id, phone_number,
                MAX(attempts) + 1 AS attempts
         FROM message_inbox
         WHERE status = 'processing'
         GROUP BY tenant_id, channel_account_id, phone_number
       ) AS turn
       WHERE message_inbox.tenant_id = turn.tenant_id
         AND message_inbox.channel_account_id = turn.channel_account_id
         AND message_inbox.phone_number = turn.phone_number
         AND (message_inbox.status = 'processing'
              OR (message_inbox.status = 'pending' AND turn.attempts >= ?))`,
    )
    .run(INTERRUPTED_TURN, MAX_TURN_ATTEMPTS, MAX_TURN_ATTEMPTS).changes;
}

/**
 * Records a message whose turn failed outside the queue, such as a held message
 * answered after maintenance. It enters `failed` and unstamped, so the handoff
 * reaches the customer like any other failed row.
 */
export function storeFailedTurn(
  ref: ConversationRef,
  message: { id: string; body: string; timestamp: number },
  error: string,
): void {
  const now = Date.now();

  db.prepare(
    `INSERT INTO message_inbox (tenant_id, channel_account_id, phone_number, message_text, message_id, whatsapp_timestamp, created_at, status, attempts, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?)
     ON CONFLICT(message_id) DO NOTHING`,
  ).run(
    ref.tenantId,
    ref.channelAccountId,
    ref.phoneNumber,
    message.body,
    message.id,
    message.timestamp,
    now,
    MAX_TURN_ATTEMPTS,
    error,
  );
}

export type FailedTurn = {
  id: number;
  last_error: string | null;
};

/** Returns unhanded `failed` rows for a conversation, oldest first. */
export function unhandedFailedTurns(ref: ConversationRef): FailedTurn[] {
  return getAll<FailedTurn>(
    `SELECT id, last_error FROM message_inbox
     WHERE status = 'failed' AND handed_off_at IS NULL
       AND tenant_id = ? AND channel_account_id = ? AND phone_number = ?
     ORDER BY id`,
    [ref.tenantId, ref.channelAccountId, ref.phoneNumber],
  );
}

/**
 * The conversations that own a `failed` row no handoff has covered. A suspended
 * tenant's rows wait for it to reopen.
 */
export function conversationsWithFailedTurns(): ConversationRef[] {
  return getAll<{
    tenant_id: string;
    channel_account_id: string;
    phone_number: string;
  }>(
    `SELECT DISTINCT tenant_id, channel_account_id, phone_number
     FROM message_inbox
     WHERE status = 'failed' AND handed_off_at IS NULL AND ${openTenantsOnly()}`,
  ).map((row) => ({
    tenantId: row.tenant_id,
    channelAccountId: row.channel_account_id,
    phoneNumber: row.phone_number,
  }));
}

/** Stamps the handoff on `failed` rows. A stamped row keeps its first time. */
export function markTurnsHandedOff(ids: number[], now: number): void {
  if (ids.length === 0) return;

  db.prepare(
    `UPDATE message_inbox SET handed_off_at = ?
     WHERE id IN (${ids.map(() => "?").join(", ")})
       AND status = 'failed' AND handed_off_at IS NULL`,
  ).run(now, ...ids);
}

/**
 * Queue depth. `tenantId` null counts across open tenants. `getWorkerStatus`
 * relies on that default, and so may an unpinned platform operator.
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

/** Delete processed inbox rows processed before `before` (epoch ms). */
export function purgeProcessedInbox(before: number): number {
  return db
    .prepare(
      "DELETE FROM message_inbox WHERE status = 'processed' AND processed_at < ?",
    )
    .run(before).changes;
}

import { db } from "../db/index.ts";
import {
  activeChannelAccountsOnly,
  getAll,
  getOne,
  openTenantsOnly,
} from "../db/query.ts";
import { createLogger } from "../lib/logger.ts";
import type { ConversationRef } from "@vendeya/types";
import type {
  OutboundMessage,
  SendOutcome,
} from "../adapters/whatsapp/types.ts";

/*
 * The states of an outbox row, and who moves each one.
 *
 *  - pending: the reply is owed. `WhatsAppService` inserts it when an inline
 *    send failed in a way a later attempt can fix, or when the conversation
 *    already owed a reply and this one must queue behind it. It leaves pending
 *    through `claimRow`, `expirePending` or `cancelPending`.
 *  - sending: one attempt is in flight. The worker holds the conversation lock
 *    from the claim to the recorded outcome, so only the worker that claimed
 *    the row moves it on. A process that dies here leaves the row sending, and
 *    `startOutboxWorker` records that as one ambiguous attempt, for an open
 *    tenant only. A database that refuses to record an outcome also leaves the
 *    row sending until the next boot, and the conversation's later replies
 *    queue behind it.
 *  - sent: the adapter accepted it, and the `messages` row carries Meta's id.
 *  - failed: permanent, out of budget, a second ambiguous outcome, or past
 *    `MAX_AGE_MS`. `last_reason` says which. The customer got no answer, so
 *    the handoff in outbox-handoff.ts alerts a person and stamps
 *    `handed_off_at`. A failed row with no stamp is a handoff still owed.
 *  - cancelled: a person took the conversation over before it went out.
 *
 * sent, failed and cancelled are final. The worker claims only a conversation's
 * lowest-numbered pending or sending row, so replies go out in the order the
 * bot produced them.
 */

const logger = createLogger("outbox");

/** Delay before the retry that follows attempt 1, 2, 3 and 4 of a transient failure. */
export const TRANSIENT_RETRY_DELAYS_MS = [
  5_000,
  30_000,
  2 * 60_000,
  10 * 60_000,
] as const;

/**
 * An ambiguous send may already have been delivered, so it is repeated once and
 * on the shortest delay, whichever attempt it happened on.
 */
export const AMBIGUOUS_RETRY_DELAY_MS = 5_000;

/** Recorded outcomes a row may collect. The inline send is attempt 1. */
export const MAX_ATTEMPTS = 5;

/** A reply this old is no longer worth delivering, so the row fails as `expired`. */
export const MAX_AGE_MS = 60 * 60 * 1000;

/** How long the worker waits after finding the conversation's number switched off. */
export const CHANNEL_UNAVAILABLE_DELAY_MS = 60_000;

/** How long a final row is kept before the hourly purge deletes it. */
export const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type OutboxStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type OutboxRow = {
  id: number;
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  message_id: string;
  type: "text" | "image";
  content: string;
  caption: string | null;
  status: OutboxStatus;
  attempts: number;
  ambiguous_attempts: number;
  last_kind: string | null;
  last_reason: string | null;
  next_attempt_at: number;
  created_at: number;
  updated_at: number;
  handed_off_at: number | null;
};

/** What the step function reads. A row that has never been attempted has both counters at 0. */
export type OutboxCounters = {
  attempts: number;
  ambiguousAttempts: number;
  createdAt: number;
};

/** Where an outcome leaves the row. `pending` is the only non-final state it returns. */
export type OutboxStep = {
  status: "pending" | "sent" | "failed";
  attempts: number;
  ambiguousAttempts: number;
  nextAttemptAt: number;
  lastKind: string | null;
  lastReason: string | null;
};

/**
 * The retry budget, as one decision. `WhatsAppService` calls it for the inline
 * attempt and the worker for every later one, so the two cannot drift.
 */
export function stepOutbox(
  counters: OutboxCounters,
  outcome: SendOutcome,
  now: number,
): OutboxStep {
  const attempts = counters.attempts + 1;

  if (outcome.ok) {
    return {
      status: "sent",
      attempts,
      ambiguousAttempts: counters.ambiguousAttempts,
      nextAttemptAt: now,
      lastKind: "accepted",
      lastReason: null,
    };
  }

  const ambiguousAttempts =
    counters.ambiguousAttempts + (outcome.kind === "ambiguous" ? 1 : 0);
  const counted = { attempts, ambiguousAttempts, lastKind: outcome.kind };
  const failed = (reason: string): OutboxStep => ({
    ...counted,
    status: "failed",
    nextAttemptAt: now,
    lastReason: reason,
  });

  if (outcome.kind === "permanent") return failed(outcome.reason);
  if (now - counters.createdAt >= MAX_AGE_MS) return failed("expired");
  if (attempts >= MAX_ATTEMPTS) return failed("exhausted");

  // A second ambiguous outcome would risk a third delivery of the same reply.
  if (outcome.kind === "ambiguous" && ambiguousAttempts > 1) {
    return failed(outcome.reason);
  }

  const delay =
    outcome.kind === "ambiguous"
      ? AMBIGUOUS_RETRY_DELAY_MS
      : TRANSIENT_RETRY_DELAYS_MS[attempts - 1]!;

  return {
    ...counted,
    status: "pending",
    nextAttemptAt: now + delay,
    lastReason: outcome.reason,
  };
}

/** The state a row carries when it queues behind one the conversation already has. */
export function queuedBehind(now: number): OutboxStep {
  return {
    status: "pending",
    attempts: 0,
    ambiguousAttempts: 0,
    nextAttemptAt: now,
    lastKind: null,
    lastReason: null,
  };
}

/** The `messages.status` that goes with an outbox state. */
function messageStatus(status: OutboxStatus): string {
  if (status === "sent") return "sent";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "queued";
}

/** Whether this conversation already owes a reply, so a new one must queue behind it. */
export function hasQueuedReply(ref: ConversationRef): boolean {
  const row = getOne<{ id: number }>(
    `SELECT id FROM outbox
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
       AND status IN ('pending', 'sending')
     LIMIT 1`,
    [ref.tenantId, ref.channelAccountId, ref.phoneNumber],
  );
  return row !== undefined;
}

/** Append a reply to the conversation's queue. `id` gives the order it goes out in. */
export function enqueue(args: {
  ref: ConversationRef;
  messageId: string;
  message: OutboundMessage;
  state: OutboxStep;
  now: number;
}): number {
  const { ref, messageId, message, state, now } = args;

  const result = db
    .prepare(
      `INSERT INTO outbox
         (tenant_id, channel_account_id, phone_number, message_id, type, content,
          caption, status, attempts, ambiguous_attempts, last_kind, last_reason,
          next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ref.tenantId,
      ref.channelAccountId,
      ref.phoneNumber,
      messageId,
      message.type,
      message.content,
      message.type === "image" ? (message.caption ?? null) : null,
      state.status,
      state.attempts,
      state.ambiguousAttempts,
      state.lastKind,
      state.lastReason,
      state.nextAttemptAt,
      now,
      now,
    );

  return Number(result.lastInsertRowid);
}

/**
 * What the worker needs to send a queued reply again. No product id: the
 * adapter does not take one, and the `messages` row already records it.
 */
export function outboundOf(row: OutboxRow): OutboundMessage {
  if (row.type === "image") {
    return {
      type: "image",
      content: row.content,
      caption: row.caption ?? undefined,
    };
  }
  return { type: "text", content: row.content };
}

/** The conversation's lowest-numbered pending or sending row, or undefined when it owes nothing. */
export function headRow(ref: ConversationRef): OutboxRow | undefined {
  return getOne<OutboxRow>(
    `SELECT * FROM outbox
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
       AND status IN ('pending', 'sending')
     ORDER BY id
     LIMIT 1`,
    [ref.tenantId, ref.channelAccountId, ref.phoneNumber],
  );
}

/**
 * Takes the row out of the pending set, so no later pass sends it twice. Gives
 * back the claimed row, or undefined when another writer moved it first.
 */
export function claimRow(row: OutboxRow, now: number): OutboxRow | undefined {
  const changed = db
    .prepare(
      "UPDATE outbox SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'pending'",
    )
    .run(now, row.id).changes;

  if (changed !== 1) return undefined;

  return { ...row, status: "sending", updated_at: now };
}

/**
 * Move the row and the `messages` row it owns together, so the thread never
 * shows a reply as queued once the row is final.
 */
export function recordOutcome(
  row: OutboxRow,
  outcome: SendOutcome,
  now: number,
): OutboxStep {
  const step = stepOutbox(
    {
      attempts: row.attempts,
      ambiguousAttempts: row.ambiguous_attempts,
      createdAt: row.created_at,
    },
    outcome,
    now,
  );

  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE outbox
       SET status = ?, attempts = ?, ambiguous_attempts = ?, last_kind = ?,
           last_reason = ?, next_attempt_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      step.status,
      step.attempts,
      step.ambiguousAttempts,
      step.lastKind,
      step.lastReason,
      step.nextAttemptAt,
      now,
      row.id,
    );

    db.prepare(
      "UPDATE messages SET status = ?, whatsapp_message_id = ? WHERE id = ?",
    ).run(
      messageStatus(step.status),
      outcome.ok ? outcome.messageId : null,
      row.message_id,
    );
  });
  apply();

  return step;
}

/**
 * Put a claimed row back without counting an attempt. The number the
 * conversation runs on was switched off, which no attempt could have fixed.
 */
export function deferUnavailable(id: number, now: number): void {
  db.prepare(
    `UPDATE outbox SET status = 'pending', next_attempt_at = ?, updated_at = ?
     WHERE id = ? AND status = 'sending'`,
  ).run(now + CHANNEL_UNAVAILABLE_DELAY_MS, now, id);
}

/**
 * Fail the conversation's pending rows that are past the age limit. It counts
 * no attempt, because no attempt was made.
 */
export function expirePending(ref: ConversationRef, now: number): number {
  const cutoff = now - MAX_AGE_MS;

  const expire = db.transaction(() => {
    db.prepare(
      `UPDATE messages SET status = 'failed'
       WHERE id IN (
         SELECT message_id FROM outbox
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
           AND status = 'pending' AND created_at <= ?
       )`,
    ).run(ref.tenantId, ref.channelAccountId, ref.phoneNumber, cutoff);

    return db
      .prepare(
        `UPDATE outbox
         SET status = 'failed', last_reason = 'expired', updated_at = ?
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
           AND status = 'pending' AND created_at <= ?`,
      )
      .run(now, ref.tenantId, ref.channelAccountId, ref.phoneNumber, cutoff)
      .changes;
  });

  return expire();
}

/**
 * Drop the replies the bot had queued, because a person now owns the
 * conversation or is being given it. Only `pending` rows: the caller holds the
 * conversation lock, so no attempt can be in flight. Gives back how many were
 * dropped.
 */
export function cancelPending(ref: ConversationRef): number {
  const cancel = db.transaction(() => {
    db.prepare(
      `UPDATE messages SET status = 'cancelled'
       WHERE id IN (
         SELECT message_id FROM outbox
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
           AND status = 'pending'
       )`,
    ).run(ref.tenantId, ref.channelAccountId, ref.phoneNumber);

    return db
      .prepare(
        `UPDATE outbox SET status = 'cancelled', updated_at = ?
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
           AND status = 'pending'`,
      )
      .run(Date.now(), ref.tenantId, ref.channelAccountId, ref.phoneNumber)
      .changes;
  });

  return cancel();
}

/**
 * The conversations the worker looks at this pass: those with a row past the
 * age limit, and those whose head row is due on a number that can send.
 */
export function conversationsNeedingOutbox(now: number): ConversationRef[] {
  const stale = getAll<{
    tenant_id: string;
    channel_account_id: string;
    phone_number: string;
  }>(
    `SELECT DISTINCT tenant_id, channel_account_id, phone_number FROM outbox
     WHERE status = 'pending' AND created_at <= ? AND ${openTenantsOnly()}`,
    [now - MAX_AGE_MS],
  );

  const due = getAll<{
    tenant_id: string;
    channel_account_id: string;
    phone_number: string;
  }>(
    `SELECT o.tenant_id, o.channel_account_id, o.phone_number FROM outbox o
     WHERE o.status = 'pending'
       AND o.next_attempt_at <= ?
       AND o.id = (
         SELECT MIN(head.id) FROM outbox head
         WHERE head.tenant_id = o.tenant_id
           AND head.channel_account_id = o.channel_account_id
           AND head.phone_number = o.phone_number
           AND head.status IN ('pending', 'sending')
       )
       AND ${openTenantsOnly("o.tenant_id")}
       AND ${activeChannelAccountsOnly("o.channel_account_id")}`,
    [now],
  );

  const refs = new Map<string, ConversationRef>();
  for (const row of [...stale, ...due]) {
    const ref = {
      tenantId: row.tenant_id,
      channelAccountId: row.channel_account_id,
      phoneNumber: row.phone_number,
    };
    refs.set(`${ref.tenantId}:${ref.channelAccountId}:${ref.phoneNumber}`, ref);
  }

  return [...refs.values()];
}

/** The conversation's `failed` rows that no handoff has covered yet, oldest first. */
export function undeliveredRows(ref: ConversationRef): OutboxRow[] {
  return getAll<OutboxRow>(
    `SELECT * FROM outbox
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
       AND status = 'failed' AND handed_off_at IS NULL
     ORDER BY id`,
    [ref.tenantId, ref.channelAccountId, ref.phoneNumber],
  );
}

/**
 * The conversations that own a `failed` row no handoff has covered. A suspended
 * tenant's rows wait for it to reopen.
 */
export function conversationsAwaitingHandoff(): ConversationRef[] {
  return getAll<{
    tenant_id: string;
    channel_account_id: string;
    phone_number: string;
  }>(
    `SELECT DISTINCT tenant_id, channel_account_id, phone_number FROM outbox
     WHERE status = 'failed' AND handed_off_at IS NULL AND ${openTenantsOnly()}`,
  ).map((row) => ({
    tenantId: row.tenant_id,
    channelAccountId: row.channel_account_id,
    phoneNumber: row.phone_number,
  }));
}

/**
 * Stamps the handoff on `failed` rows. A row that is already stamped keeps its
 * first time. `updated_at` is left alone, so retention still counts from when
 * the row failed.
 */
export function markHandedOff(ids: number[], now: number): void {
  if (ids.length === 0) return;

  db.prepare(
    `UPDATE outbox SET handed_off_at = ?
     WHERE id IN (${ids.map(() => "?").join(", ")})
       AND status = 'failed' AND handed_off_at IS NULL`,
  ).run(now, ...ids);
}

/**
 * Rows left `sending` by a process that died mid-attempt. A suspended tenant
 * sends nothing, so its rows are left for the boot that follows its reopening,
 * by which time the age limit has caught them.
 */
export function interruptedRows(): OutboxRow[] {
  return getAll<OutboxRow>(
    `SELECT * FROM outbox WHERE status = 'sending' AND ${openTenantsOnly()}`,
  );
}

/** Delete final rows past the retention window. */
export function purgeFinishedOutbox(now: number = Date.now()): number {
  const purged = db
    .prepare(
      `DELETE FROM outbox
       WHERE status IN ('sent', 'failed', 'cancelled') AND updated_at < ?`,
    )
    .run(now - OUTBOX_RETENTION_MS).changes;

  if (purged > 0) logger.info({ purged }, "Purged outbox rows past retention");

  return purged;
}

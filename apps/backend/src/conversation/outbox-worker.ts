import {
  claimRow,
  conversationsNeedingOutbox,
  deferUnavailable,
  expirePending,
  headRow,
  interruptedRows,
  outboundOf,
  recordOutcome,
  type OutboxRow,
  type OutboxStep,
} from "./outbox.ts";
import { ConversationBusyError, LockTimeoutError, withLock } from "./locks.ts";
import { handOffUndeliverable } from "./outbox-handoff.ts";
import {
  ChannelUnavailableError,
  sendResolved,
} from "../adapters/whatsapp/index.ts";
import type { SendOutcome } from "../adapters/whatsapp/types.ts";
import type { ConversationRef } from "@vendeya/types";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("outbox-worker");

const POLL_INTERVAL_MS = 1000;

let isRunning = false;
let workerPromise: Promise<void> | null = null;

/**
 * Starts the one worker this process runs. Rows left `sending` by a process
 * that died cannot belong to a live attempt, so they are recorded as
 * interrupted before the first pass.
 */
export function startOutboxWorker(): void {
  if (isRunning) {
    logger.debug("Worker already running");
    return;
  }

  recoverInterrupted();

  isRunning = true;
  logger.info("Outbox worker started");

  workerPromise = runWorkerLoop();
}

export async function stopOutboxWorker(): Promise<void> {
  if (!isRunning) {
    return;
  }

  isRunning = false;

  if (workerPromise) {
    await workerPromise;
  }

  logger.info("Outbox worker stopped");
}

async function runWorkerLoop(): Promise<void> {
  while (isRunning) {
    try {
      await processDueOutbox();
    } catch (error) {
      logger.error({ error }, "Outbox loop failed");
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * One pass over the queue. Conversations are answered in parallel and each one
 * inside its own lock. The handoff runs after the due rows, so a row that fails
 * in this pass is handed off in this pass unless its conversation is busy.
 * Exported so a test can drive it with a clock it controls instead of starting
 * a worker and waiting on a timer.
 */
export async function processDueOutbox(
  now: number = Date.now(),
): Promise<void> {
  const at = passClock(now);

  const refs = conversationsNeedingOutbox(now);
  await Promise.all(refs.map((ref) => processConversation(ref, at)));

  await handOffUndeliverable(at);
}

type PassClock = () => number;

/**
 * What the time is now, for a pass that started at `now`. A delay counted from
 * the pass's start has partly elapsed by the time the row is written, which
 * puts an ambiguous retry straight back in the next poll and loses the spacing
 * that keeps a duplicate apart. `performance.now()` is monotonic, so a wall
 * clock that steps cannot move the delay.
 */
function passClock(now: number): PassClock {
  const started = performance.now();
  return () => now + Math.round(performance.now() - started);
}

/**
 * The lock spans the claim and the recorded outcome, so a takeover never sees a
 * live attempt's `sending` row and this never sends a row a takeover already
 * cancelled.
 */
async function processConversation(
  ref: ConversationRef,
  at: PassClock,
): Promise<void> {
  // Named in the error log below: a throw after the claim leaves that row
  // `sending`, and the row id is what an operator needs to find it.
  let claimedId: number | undefined;

  try {
    await withLock(ref, async () => {
      // Read after the lock wait, not before it.
      const now = at();
      expirePending(ref, now);

      const head = headRow(ref);
      if (!head || head.status !== "pending") return;
      if (head.next_attempt_at > now) return;

      const claimed = claimRow(head, now);
      if (!claimed) {
        logger.warn(
          { outboxId: head.id },
          "Outbox row moved before it could be claimed",
        );
        return;
      }

      claimedId = claimed.id;
      await attempt(ref, claimed, at);
    });
  } catch (error) {
    if (error instanceof ConversationBusyError) {
      // Nothing ran, so the row is untouched and the next pass tries again.
      logger.debug(
        { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId },
        "Conversation still busy; left the queue for later",
      );
      return;
    }

    if (error instanceof LockTimeoutError) {
      recordLateAttempt(ref, error);
      return;
    }

    logger.error(
      {
        error,
        outboxId: claimedId,
        tenantId: ref.tenantId,
        channelAccountId: ref.channelAccountId,
      },
      "Outbox pass failed for a conversation",
    );
  }
}

/**
 * Sends the claimed row and records what happened. Every path either defers the
 * row or records an outcome, so only a write the database refuses leaves it
 * `sending`.
 */
async function attempt(
  ref: ConversationRef,
  row: OutboxRow,
  at: PassClock,
): Promise<void> {
  let outcome: SendOutcome;

  try {
    outcome = await sendResolved(ref, outboundOf(row));
  } catch (error) {
    if (error instanceof ChannelUnavailableError) {
      // The number was switched off. No attempt reached WhatsApp, so none is
      // counted and the row waits for the number to come back.
      deferUnavailable(row.id, at());
      logger.warn(
        {
          outboxId: row.id,
          channelAccountId: ref.channelAccountId,
          status: error.status,
        },
        "Channel account is not active; the queued reply waits",
      );
      return;
    }

    // The adapters answer with an outcome rather than throwing, so whatever
    // reached here may still have put the message on the wire.
    outcome = { ok: false, kind: "ambiguous", reason: "send_threw" };
    logger.error({ error, outboxId: row.id }, "Outbox send threw");
  }

  // The delay the step schedules runs from here, the end of the attempt.
  const step = recordOutcome(row, outcome, at());

  logger.info(recordedOutcome(row, step), "Outbox attempt recorded");
}

/**
 * The fields every recorded outcome is logged with. No phone number, no message
 * text and no token: `reason` is the adapter's short label.
 */
function recordedOutcome(row: OutboxRow, step: OutboxStep) {
  return {
    outboxId: row.id,
    messageId: row.message_id,
    tenantId: row.tenant_id,
    channelAccountId: row.channel_account_id,
    kind: step.lastKind,
    reason: step.lastReason,
    attempts: step.attempts,
    status: step.status,
  };
}

/**
 * The attempt still holds the lock and still records its own outcome, so
 * nothing is repaired here. It is logged once it settles.
 */
function recordLateAttempt(
  ref: ConversationRef,
  timeout: LockTimeoutError,
): void {
  logger.warn(
    { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId },
    "Lock timed out while sending a queued reply; the attempt is still running",
  );

  const settled = () =>
    logger.info(
      { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId },
      "Timed-out outbox attempt settled",
    );

  timeout.operation.then(settled, settled);
}

/**
 * Turns each row a dead process left `sending` into one ambiguous attempt. One
 * process runs the worker, so such a row cannot belong to a live attempt. A
 * suspended tenant's rows are left for the boot that follows its reopening.
 */
function recoverInterrupted(): void {
  const rows = interruptedRows();
  if (rows.length === 0) return;

  const now = Date.now();
  for (const row of rows) {
    const step = recordOutcome(
      row,
      { ok: false, kind: "ambiguous", reason: "interrupted" },
      now,
    );
    logger.info(recordedOutcome(row, step), "Outbox attempt recorded");
  }

  logger.warn({ count: rows.length }, "Recovered interrupted outbox attempts");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

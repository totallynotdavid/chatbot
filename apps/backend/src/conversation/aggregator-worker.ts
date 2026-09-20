import {
  type AggregatedGroup,
  getReadyForAggregation,
  markAsPending,
  markAsProcessing,
  markAsProcessed,
  markAsFailed,
  countPending,
  countFailed,
} from "./message-inbox.ts";
import { handleMessage } from "./handler/index.ts";
import { ConversationBusyError, LockTimeoutError } from "./locks.ts";
import { ChannelUnavailableError } from "../adapters/whatsapp/index.ts";
import type { ConversationRef, QuotedMessageContext } from "@totem/types";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("aggregator");

// Time window for possible new messages before processing
const QUIET_WINDOW_MS = 2000;
const POLL_INTERVAL_MS = 100; // Check for ready messages every 100ms

let isRunning = false;
let workerPromise: Promise<void> | null = null;

export function startAggregatorWorker(): void {
  if (isRunning) {
    logger.debug("Worker already running");
    return;
  }

  isRunning = true;
  logger.info("Aggregator worker started");

  workerPromise = runWorkerLoop();
}

export async function stopAggregatorWorker(): Promise<void> {
  if (!isRunning) {
    return;
  }

  isRunning = false;

  if (workerPromise) {
    await workerPromise;
  }

  logger.info("Aggregator worker stopped");
}

async function runWorkerLoop(): Promise<void> {
  while (isRunning) {
    try {
      await processReadyMessages();
    } catch (error) {
      logger.error({ error }, "Aggregator loop failed");
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * One pass of the queue: everything ready right now, answered in parallel.
 * Exported with `processGroup` so a test can drive the queue directly instead
 * of starting a worker and waiting on a timer.
 */
export async function processReadyMessages(): Promise<void> {
  const readyGroups = getReadyForAggregation(QUIET_WINDOW_MS);

  if (readyGroups.length === 0) {
    return;
  }

  logger.debug({ count: readyGroups.length }, "Processing message groups");

  await Promise.all(readyGroups.map((group) => processGroup(group)));
}

/** One conversation's batch. Its statuses are listed in message-inbox.ts. */
export async function processGroup(group: AggregatedGroup): Promise<void> {
  const ref = {
    tenantId: group.tenant_id,
    channelAccountId: group.channel_account_id,
    phoneNumber: group.phone_number,
  };

  markAsProcessing(group.ids);

  logger.debug(
    { tenantId: ref.tenantId, phoneNumber: ref.phoneNumber, ids: group.ids },
    "Processing group",
  );

  try {
    await handleMessage({
      ref,
      content: group.aggregated_text,
      timestamp: group.oldest_timestamp,
      messageId: group.latest_message_id,
      quotedContext: parseQuotedContext(group, ref),
    });
  } catch (error) {
    if (error instanceof LockTimeoutError) {
      recordLateOutcome(group, ref, error);
      return;
    }
    recordUnanswered(group, ref, error);
    return;
  }

  markAsProcessed(group.ids);
}

function parseQuotedContext(
  group: AggregatedGroup,
  ref: ConversationRef,
): QuotedMessageContext | undefined {
  if (!group.quoted_message_context) return undefined;

  try {
    return JSON.parse(group.quoted_message_context);
  } catch (error) {
    logger.warn(
      { error, tenantId: ref.tenantId, phoneNumber: ref.phoneNumber },
      "Failed to parse quoted context",
    );
    return undefined;
  }
}

/**
 * The answer is still running and may yet reply or be refused. Handing the
 * group back now would have the next poll answer it twice. Leaving it
 * `processing` for good would never answer it if the late attempt is refused.
 * So it stays `processing` until the answer settles.
 */
function recordLateOutcome(
  group: AggregatedGroup,
  ref: ConversationRef,
  timeout: LockTimeoutError,
): void {
  logger.warn(
    { tenantId: ref.tenantId, phoneNumber: ref.phoneNumber, ids: group.ids },
    "Lock timed out while answering; the group stays processing until the answer settles",
  );

  timeout.operation
    .then(
      () => markAsProcessed(group.ids),
      (error: unknown) => recordUnanswered(group, ref, error),
    )
    .catch((error: unknown) => {
      logger.error(
        { error, tenantId: ref.tenantId, ids: group.ids },
        "Failed to record the outcome of a timed-out answer",
      );
    });
}

function recordUnanswered(
  group: AggregatedGroup,
  ref: ConversationRef,
  error: unknown,
): void {
  const context = {
    tenantId: ref.tenantId,
    channelAccountId: ref.channelAccountId,
    phoneNumber: ref.phoneNumber,
    ids: group.ids,
  };

  if (error instanceof ConversationBusyError) {
    // An earlier operation still held the conversation, so this group was never
    // started and is safe to answer on a later poll.
    markAsPending(group.ids);
    logger.warn(
      context,
      "Conversation still busy; left the group pending for later",
    );
    return;
  }

  if (error instanceof ChannelUnavailableError) {
    // The number was switched off between the dequeue and a send, and
    // `getReadyForAggregation` keeps the group out of every poll until it is
    // back. The replay is faithful because `executeCommands` persists the phase
    // and analytics, and the orchestrator emits events, only after every send
    // went out. An earlier message of the same batch may already have reached
    // the customer, and the retry sends it again.
    markAsPending(group.ids);
    logger.warn(
      { ...context, status: error.status },
      "Channel account is not active; left the group pending for later",
    );
    return;
  }

  // `handleMessage` absorbs whatever fails once it is working out a reply, so
  // what reaches here failed before one: loading the conversation, for one.
  // Pending would retry it on every poll for as long as the cause lasts.
  markAsFailed(
    group.ids,
    error instanceof Error ? error.message : String(error),
  );
  logger.error({ ...context, error }, "Group processing failed");
}

export function getWorkerStatus(): {
  running: boolean;
  pending: number;
  failed: number;
} {
  return {
    running: isRunning,
    pending: countPending(),
    failed: countFailed(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

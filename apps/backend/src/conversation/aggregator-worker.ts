import {
  getReadyForAggregation,
  markAsProcessing,
  markAsProcessed,
  markAsFailed,
  countPending,
  countFailed,
} from "./message-inbox.ts";
import { handleMessage } from "./handler.ts";

// Time window for possible new messages before processing
const QUIET_WINDOW_MS = 2000;
const POLL_INTERVAL_MS = 100; // Check for ready messages every 100ms

let isRunning = false;
let workerPromise: Promise<void> | null = null;

export function startAggregatorWorker(): void {
  if (isRunning) {
    console.log("[Aggregator] Worker already running");
    return;
  }

  isRunning = true;
  console.log("[Aggregator] Starting worker...");

  workerPromise = runWorkerLoop();
}

export async function stopAggregatorWorker(): Promise<void> {
  if (!isRunning) {
    return;
  }

  console.log("[Aggregator] Stopping worker...");
  isRunning = false;

  if (workerPromise) {
    await workerPromise;
  }

  console.log("[Aggregator] Worker stopped");
}

async function runWorkerLoop(): Promise<void> {
  while (isRunning) {
    try {
      await processReadyMessages();
    } catch (error) {
      console.error("[Aggregator] Error in worker loop:", error);
    }

    // Sleep before next poll
    await sleep(POLL_INTERVAL_MS);
  }
}

async function processReadyMessages(): Promise<void> {
  const readyGroups = getReadyForAggregation(QUIET_WINDOW_MS);

  if (readyGroups.length === 0) {
    return;
  }

  console.log(
    `[Aggregator] Processing ${readyGroups.length} ready message groups`,
  );

  await Promise.all(readyGroups.map((group) => processGroup(group)));
}

async function processGroup(group: {
  phone_number: string;
  ids: string;
  aggregated_text: string;
  oldest_timestamp: number;
  latest_message_id: string;
}): Promise<void> {
  try {
    // Mark as processing to prevent double-processing
    markAsProcessing(group.ids);

    console.log(
      `[Aggregator] Processing group for ${group.phone_number}: ${group.ids}`,
    );

    // Process conversation
    await handleMessage({
      phoneNumber: group.phone_number,
      content: group.aggregated_text,
      timestamp: group.oldest_timestamp,
      messageId: group.latest_message_id,
    });

    // Mark as successfully processed
    markAsProcessed(group.ids);

    console.log(
      `[Aggregator] Successfully processed group for ${group.phone_number}`,
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    console.error(
      `[Aggregator] Failed to process group for ${group.phone_number}:`,
      error,
    );

    // Mark as failed for retry later
    markAsFailed(group.ids, errorMessage);
  }
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

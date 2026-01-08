import type { Conversation } from "@totem/types";
import { processMessagePipeline } from "./pipeline.ts";
import {
  dequeueNextGroup,
  markGroupProcessed,
  markGroupFailed,
  detectBacklog,
  getPendingCount,
  cleanupOldMessages,
} from "./queue.ts";
import { executeCommand } from "./dispatcher.ts";
import { assignNextAgent } from "../../services/assignment.ts";
import { db } from "../../db/index.ts";
import { buildStateContext } from "./context.ts";

const POLL_INTERVAL_MS = 500;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

let isRunning = false;
let processorInterval: Timer | null = null;
let cleanupInterval: Timer | null = null;

export function startProcessor(): void {
  if (isRunning) {
    console.log("[Processor] Already running");
    return;
  }

  isRunning = true;
  console.log("[Processor] Starting message processor...");

  processorInterval = setInterval(async () => {
    await processNextBatch();
  }, POLL_INTERVAL_MS);

  cleanupInterval = setInterval(() => {
    const deleted = cleanupOldMessages();
    if (deleted > 0) {
      console.log(`[Processor] Cleaned up ${deleted} old messages`);
    }
  }, CLEANUP_INTERVAL_MS);

  console.log("[Processor] Started successfully");
}

export function stopProcessor(): void {
  if (!isRunning) {
    return;
  }

  console.log("[Processor] Stopping message processor...");

  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
  }

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  isRunning = false;
  console.log("[Processor] Stopped");
}

async function processNextBatch(): Promise<void> {
  try {
    const messageGroup = dequeueNextGroup();

    if (!messageGroup || messageGroup.length === 0) {
      return;
    }

    const firstMessage = messageGroup[0];
    if (!firstMessage) {
      return;
    }

    const groupId = firstMessage.group_id!;
    const phoneNumber = firstMessage.phone_number;

    const aggregatedText = messageGroup.map((m) => m.message_text).join(" ");

    const { isBacklog, oldestMessageAge } = detectBacklog(messageGroup);

    console.log(
      `[Processor] Processing group ${groupId} (${messageGroup.length} messages) for ${phoneNumber}`,
    );

    try {
      const output = await processMessagePipeline(phoneNumber, aggregatedText, {
        isBacklog,
        oldestMessageAge,
      });

      const conv = db
        .prepare("SELECT * FROM conversations WHERE phone_number = ?")
        .get(phoneNumber) as Conversation;

      if (!conv) {
        throw new Error(`Conversation not found for ${phoneNumber}`);
      }

      const context = buildStateContext(conv);

      for (const command of output.commands) {
        await executeCommand(conv, command, context);
      }

      if (output.shouldAssignAgent) {
        await assignNextAgent(phoneNumber, conv.client_name);
      }

      markGroupProcessed(groupId);

      console.log(`[Processor] Completed group ${groupId}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      markGroupFailed(groupId, errorMessage);

      console.error(`[Processor] Failed to process group ${groupId}:`, error);
    }
  } catch (error) {
    console.error("[Processor] Error in processNextBatch:", error);
  }
}

export function getProcessorStatus(): {
  isRunning: boolean;
  pendingCount: number;
} {
  return {
    isRunning,
    pendingCount: getPendingCount(),
  };
}

import type {
  ConversationPhase,
  ConversationMetadata,
  TransitionResult,
  EnrichmentResult,
  Command,
} from "@totem/core";
import { transition } from "@totem/core";
import { withLock } from "./locks.ts";
import { executeEnrichment } from "./enrichment.ts";

import {
  getOrCreateConversation,
  updateConversation,
  isSessionTimedOut,
  resetSession,
} from "./store.ts";
import { WhatsAppService } from "../adapters/whatsapp/index.ts";
import { notifyTeam } from "../adapters/notifier/client.ts";
import { sendBundleImages } from "./images.ts";
import { trackEvent } from "../domains/analytics/index.ts";

const RESPONSE_DELAY_MS = parseInt(
  process.env.BOT_RESPONSE_DELAY_MS || "4000",
  10,
);
const BACKLOG_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ENRICHMENT_LOOPS = 10; // Safety limit

export type IncomingMessage = {
  phoneNumber: string;
  content: string;
  timestamp: number; // WhatsApp message timestamp
  messageId: string;
};

export async function handleMessage(message: IncomingMessage): Promise<void> {
  const { phoneNumber, content, timestamp, messageId } = message;

  // Process with per-user lock
  await withLock(phoneNumber, async () => {
    console.log(`[Handler] Processing message from ${phoneNumber}`);

    // Get or create conversation
    let conversation = getOrCreateConversation(phoneNumber);

    // Check for session timeout
    if (isSessionTimedOut(conversation.metadata)) {
      console.log(`[Handler] Session timed out, resetting for ${phoneNumber}`);
      resetSession(phoneNumber, conversation.metadata.lastCategory);
      conversation = getOrCreateConversation(phoneNumber);
      conversation.metadata.isReturningUser = true;
    }

    // Calculate message age for backlog detection
    const messageAgeMs = Date.now() - timestamp;
    const isBacklogged = messageAgeMs > BACKLOG_THRESHOLD_MS;

    // Mark as read and show typing
    await WhatsAppService.markAsReadAndShowTyping(messageId);

    // Run enrichment loop
    const result = await runEnrichmentLoop(
      conversation.phase,
      content,
      conversation.metadata,
      phoneNumber,
    );

    // Apply human-like delay (unless backlogged)
    if (!isBacklogged && RESPONSE_DELAY_MS > 0) {
      const elapsed = Date.now() - timestamp;
      const remainingDelay = Math.max(0, RESPONSE_DELAY_MS - elapsed);
      if (remainingDelay > 0) {
        await sleep(remainingDelay);
      }
    }

    // Execute the transition result
    await executeResult(
      result,
      phoneNumber,
      conversation.metadata,
      conversation.isSimulation,
    );
  });
}

async function runEnrichmentLoop(
  phase: ConversationPhase,
  message: string,
  metadata: ConversationMetadata,
  phoneNumber: string,
): Promise<TransitionResult> {
  let currentPhase = phase;
  let enrichment: EnrichmentResult | undefined;
  let iterations = 0;

  while (iterations < MAX_ENRICHMENT_LOOPS) {
    iterations++;

    const result = transition({
      phase: currentPhase,
      message,
      metadata,
      enrichment,
    });

    if (result.type !== "need_enrichment") {
      return result;
    }

    // Execute enrichment and continue loop
    console.log(
      `[Handler] Enrichment needed: ${result.enrichment.type} (iteration ${iterations})`,
    );

    // Persist pending phase immediately to prevent state loss on crash
    if (result.pendingPhase) {
      currentPhase = result.pendingPhase;
      updateConversation(phoneNumber, currentPhase, metadata);
    }

    enrichment = await executeEnrichment(result.enrichment, phoneNumber);
  }

  // Safety: too many loops, escalate
  console.error(`[Handler] Max enrichment loops exceeded for ${phoneNumber}`);
  return {
    type: "update",
    nextPhase: {
      phase: "escalated",
      reason: "enrichment_loop_exceeded",
    },
    commands: [
      {
        type: "NOTIFY_TEAM",
        channel: "dev",
        message: `Max enrichment loops for ${phoneNumber}`,
      },
      { type: "ESCALATE", reason: "enrichment_loop_exceeded" },
    ],
  };
}

async function executeResult(
  result: TransitionResult,
  phoneNumber: string,
  metadata: ConversationMetadata,
  isSimulation: boolean,
): Promise<void> {
  if (result.type === "need_enrichment") {
    // Should not reach here, loop should handle it
    console.error("[Handler] Unexpected need_enrichment in executeResult");
    await notifyTeam(
      "dev",
      `CRITICAL: need_enrichment leaked to executeResult for ${phoneNumber}`,
    );
    return;
  }

  // Update phase if it changed
  const currentConversation = getOrCreateConversation(phoneNumber);
  if (
    JSON.stringify(currentConversation.phase) !==
    JSON.stringify(result.nextPhase)
  ) {
    updateConversation(phoneNumber, result.nextPhase, metadata);
  }

  // Execute commands sequentially with delay between messages
  for (let i = 0; i < result.commands.length; i++) {
    const command = result.commands[i];
    if (!command) continue;

    // Add 150ms delay between SEND_MESSAGE commands for natural pacing
    if (i > 0 && command.type === "SEND_MESSAGE") {
      const prevCommand = result.commands[i - 1];
      if (prevCommand?.type === "SEND_MESSAGE") {
        await sleep(150);
      }
    }

    await executeCommand(
      command,
      phoneNumber,
      result.nextPhase,
      metadata,
      isSimulation,
    );
  }
}

async function executeCommand(
  command: Command,
  phoneNumber: string,
  phase: ConversationPhase,
  metadata: ConversationMetadata,
  isSimulation: boolean,
): Promise<void> {
  switch (command.type) {
    case "SEND_MESSAGE":
      await sendMessage(phoneNumber, command.text, isSimulation);
      break;

    case "SEND_IMAGES":
      await executeImages(command, phoneNumber, phase, isSimulation);
      break;

    case "TRACK_EVENT":
      trackEvent(phoneNumber, command.event, {
        segment: metadata.segment,
        ...command.metadata,
      });
      break;

    case "NOTIFY_TEAM":
      await notifyTeam(command.channel, command.message);
      break;

    case "ESCALATE":
      // Phase update already handled in executeResult
      console.log(`[Handler] Escalation: ${command.reason}`);
      break;
  }
}

async function sendMessage(
  phoneNumber: string,
  content: string,
  isSimulation: boolean,
): Promise<void> {
  if (isSimulation) {
    WhatsAppService.logMessage(
      phoneNumber,
      "outbound",
      "text",
      content,
      "sent",
    );
  } else {
    await WhatsAppService.sendMessage(phoneNumber, content);
  }
}

async function executeImages(
  command: Extract<Command, { type: "SEND_IMAGES" }>,
  phoneNumber: string,
  phase: ConversationPhase,
  isSimulation: boolean,
): Promise<void> {
  if (
    phase.phase !== "offering_products" &&
    phase.phase !== "handling_objection"
  ) {
    console.warn("[Handler] Images requested outside offering phase");
    return;
  }

  const credit = "credit" in phase ? phase.credit : 0;
  const segment = "segment" in phase ? phase.segment : "fnb";

  const result = await sendBundleImages({
    phoneNumber,
    segment,
    category: command.category,
    creditLine: credit,
    isSimulation,
  });

  // Update phase with sent products for validation in next message
  if (result.success && result.products.length > 0) {
    const updatedPhase: ConversationPhase = {
      ...phase,
      sentProducts: result.products,
    };
    const conversation = getOrCreateConversation(phoneNumber);
    updateConversation(phoneNumber, updatedPhase, conversation.metadata);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

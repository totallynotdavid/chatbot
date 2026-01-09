/**
 * Message Handler
 *
 * Main entry point for processing incoming WhatsApp messages.
 * Implements:
 * - Per-user locking (parallel across users, serial per user)
 * - Enrichment loop (runs state machine, executes enrichments, repeats)
 * - Human-like response timing (configurable delay from message timestamp)
 * - Backlog detection (skip delay for old messages)
 */

import { conversation } from "@totem/core";
import { withLock } from "./locks.ts";
import { executeEnrichment } from "./enrichment.ts";

type ConversationPhase = conversation.ConversationPhase;
type ConversationMetadata = conversation.ConversationMetadata;
type TransitionResult = conversation.TransitionResult;
type EnrichmentResult = conversation.EnrichmentResult;
type NotifyCommand = conversation.NotifyCommand;
type ImageCommand = conversation.ImageCommand;
type TrackEvent = conversation.TrackEvent;
import {
  getOrCreateConversation,
  updateConversation,
  isSessionTimedOut,
  resetSession,
} from "./store.ts";
import { WhatsAppService } from "../services/whatsapp/index.ts";
import { notifyTeam } from "../services/notifier.ts";
import { sendBundleImages } from "./images.ts";
import { trackEvent } from "../services/analytics.ts";

// Configuration
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

/**
 * Handle an incoming message with locking and enrichment loop
 */
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

/**
 * Run the state machine with enrichment loop
 */
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

    const result = conversation.transition({
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
    type: "escalate",
    reason: "enrichment_loop_exceeded",
    notify: {
      channel: "dev",
      message: `Max enrichment loops for ${phoneNumber}`,
    },
  };
}

/**
 * Execute the transition result (send messages, update state, etc.)
 */
async function executeResult(
  result: TransitionResult,
  phoneNumber: string,
  metadata: ConversationMetadata,
  isSimulation: boolean,
): Promise<void> {
  switch (result.type) {
    case "stay":
      // No state change, just send response if any
      if (result.response) {
        await sendMessage(phoneNumber, result.response, isSimulation);
      }
      if (result.track) {
        await executeTrack(result.track, phoneNumber, metadata);
      }
      break;

    case "advance":
      // Update state and send response
      updateConversation(phoneNumber, result.nextPhase, metadata);

      if (result.response) {
        await sendMessage(phoneNumber, result.response, isSimulation);
      }
      if (result.images) {
        await executeImages(
          result.images,
          phoneNumber,
          result.nextPhase,
          isSimulation,
        );
      }
      if (result.track) {
        await executeTrack(result.track, phoneNumber, metadata);
      }
      if (result.notify) {
        await executeNotify(result.notify);
      }
      break;

    case "escalate":
      if (result.response) {
        await sendMessage(phoneNumber, result.response, isSimulation);
      }
      // Update state to escalated
      updateConversation(
        phoneNumber,
        { phase: "escalated", reason: result.reason },
        metadata,
      );
      if (result.notify) {
        await executeNotify(result.notify);
      }
      break;

    case "need_enrichment":
      // Should not reach here, loop should handle it
      console.error("[Handler] Unexpected need_enrichment in executeResult");
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
  command: ImageCommand,
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

  await sendBundleImages({
    phoneNumber,
    segment,
    category: command.category,
    creditLine: credit,
    isSimulation,
  });
}

async function executeTrack(
  event: TrackEvent,
  phoneNumber: string,
  metadata: ConversationMetadata,
): Promise<void> {
  trackEvent(phoneNumber, event.eventType, {
    segment: metadata.segment,
    ...event.metadata,
  });
}

async function executeNotify(command: NotifyCommand): Promise<void> {
  await notifyTeam(command.channel, command.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import type {
  Command,
  ConversationMetadata,
  ConversationPhase,
  TransitionResult,
} from "@vendeya/core";
import type { ConversationRef } from "@vendeya/types";
import { WhatsAppService } from "../../adapters/whatsapp/index.ts";
import { trackEvent } from "../../domains/analytics/index.ts";
import { BundleService } from "../../domains/catalog/index.ts";
import { createLogger } from "../../lib/logger.ts";
import { db } from "../../db/index.ts";
import { sendBundleImages } from "../images.ts";
import { markAsProcessed } from "../message-inbox.ts";
import { getOrCreateConversation, updateConversation } from "../store.ts";
import { sleep } from "./sleep.ts";

const logger = createLogger("commands");

/**
 * Carry out a transition: send what it says, then record that it happened.
 * A send can throw (`ChannelUnavailableError` when the number was switched off
 * mid-flight) and the queue replays the message once the number returns. The
 * replay is faithful only if nothing the transition records was written first.
 *
 * `inboxIds` are the queue rows this turn answers. The transaction records the
 * phase and marks these rows `processed` together.
 */
export async function executeCommands(
  result: TransitionResult,
  ref: ConversationRef,
  metadata: ConversationMetadata,
  isSimulation: boolean,
  traceId: string,
  inboxIds?: string,
): Promise<void> {
  const { tenantId, phoneNumber } = ref;

  if (result.type === "need_enrichment") {
    // The enrichment loop resolves every request before the executor runs.
    throw new Error(
      `Unexpected need_enrichment in executeCommands (trace ${traceId})`,
    );
  }

  // Analytics are collected, not written, and the phase is persisted once
  // after the last command. That phase includes the products an image or
  // bundle command showed. A command that throws leaves both unwritten.
  let phase = result.nextPhase;
  const tracked: TrackEventCommand[] = [];

  // A batch that throws after an earlier message in it went out sends that
  // message again on the retry. A duplicate is visible and harmless. A
  // conversation that moved on from what the customer was shown is neither.
  for (let i = 0; i < result.commands.length; i++) {
    const command = result.commands[i];
    if (!command) continue;

    // Add 1 second delay between SEND_MESSAGE commands for natural pacing
    if (i > 0 && command.type === "SEND_MESSAGE") {
      const prevCommand = result.commands[i - 1];
      if (prevCommand?.type === "SEND_MESSAGE") {
        await sleep(1000);
      }
    }

    switch (command.type) {
      case "SEND_MESSAGE":
        await sendMessage(ref, command.text, isSimulation);
        break;

      case "SEND_IMAGES":
        phase =
          (await executeImages(command, ref, result.nextPhase, isSimulation)) ??
          phase;
        break;

      case "SEND_BUNDLE":
        phase =
          (await executeSingleBundle(
            command,
            ref,
            result.nextPhase,
            isSimulation,
          )) ?? phase;
        break;

      case "TRACK_EVENT":
        tracked.push(command);
        break;
    }
  }

  // No command in the batch threw, so only now does the conversation move on.
  db.transaction(() => {
    const stored = getOrCreateConversation(ref).phase;
    if (JSON.stringify(stored) !== JSON.stringify(phase)) {
      logger.info(
        {
          tenantId,
          phoneNumber,
          fromPhase: stored.phase,
          toPhase: phase.phase,
        },
        "Phase transition",
      );
      updateConversation(ref, phase, metadata);
    }

    for (const command of tracked) {
      trackEvent(ref, command.event, {
        segment: metadata.segment,
        ...command.metadata,
      });
    }

    if (inboxIds) markAsProcessed(inboxIds);
  })();
}

type TrackEventCommand = Extract<Command, { type: "TRACK_EVENT" }>;

async function sendMessage(
  ref: ConversationRef,
  content: string,
  isSimulation: boolean,
): Promise<void> {
  if (isSimulation) {
    WhatsAppService.logMessage(ref, "outbound", "text", content, "sent");
    return;
  }

  // The phase is persisted whatever this returns.
  const outcome = await WhatsAppService.sendMessage(ref, content, {
    retry: true,
  });
  if (!outcome.ok && !outcome.queued) {
    logger.warn(
      {
        tenantId: ref.tenantId,
        channelAccountId: ref.channelAccountId,
        kind: outcome.kind,
        reason: outcome.reason,
      },
      "Text command was not sent",
    );
  }
}

/**
 * Send the images a command asks for. Returns the phase with those products
 * recorded as shown, or null when nothing was shown. The caller persists it.
 */
async function executeImages(
  command: Extract<Command, { type: "SEND_IMAGES" }>,
  ref: ConversationRef,
  phase: ConversationPhase,
  isSimulation: boolean,
): Promise<ConversationPhase | null> {
  if (
    phase.phase !== "offering_products" &&
    phase.phase !== "handling_objection"
  ) {
    logger.warn(
      {
        tenantId: ref.tenantId,
        phoneNumber: ref.phoneNumber,
        currentPhase: phase.phase,
      },
      "Images requested outside offering phase",
    );
    return null;
  }

  const credit = "credit" in phase ? phase.credit : 0;
  const segment = "segment" in phase ? phase.segment : "fnb";

  const result = await sendBundleImages({
    ref,
    segment,
    category: command.category,
    creditLine: credit,
    isSimulation,
    offset: command.offset,
    query: command.query,
  });

  // The products sent, for validating the next message against
  if (result.success && result.products.length > 0) {
    return {
      ...phase,
      sentProducts: result.products,
      lastAction: {
        type: "showed_products",
        category: command.category,
        productCount: result.products.length,
        timestamp: Date.now(),
      },
    } as ConversationPhase;
  }

  logger.debug(
    {
      tenantId: ref.tenantId,
      phoneNumber: ref.phoneNumber,
      category: command.category,
      query: command.query,
    },
    "Command executed but no products sent directly (handled by flow logic)",
  );
  return null;
}

/**
 * One bundle's image, and the phase recording it as shown. Returns null when the
 * image was not accepted. See `executeImages`.
 */
async function executeSingleBundle(
  command: Extract<Command, { type: "SEND_BUNDLE" }>,
  ref: ConversationRef,
  phase: ConversationPhase,
  isSimulation: boolean,
): Promise<ConversationPhase | null> {
  if (
    phase.phase !== "offering_products" &&
    phase.phase !== "handling_objection"
  ) {
    logger.warn(
      {
        tenantId: ref.tenantId,
        phoneNumber: ref.phoneNumber,
        currentPhase: phase.phase,
      },
      "Bundle requested outside offering phase",
    );
    return null;
  }

  const bundle = BundleService.getById(ref.tenantId, command.bundleId);

  if (!bundle) {
    logger.warn(
      {
        tenantId: ref.tenantId,
        phoneNumber: ref.phoneNumber,
        bundleId: command.bundleId,
      },
      "Bundle not found",
    );
    return null;
  }

  const installments = JSON.parse(bundle.installments_json);
  const firstOption = installments[0];
  const installmentText = firstOption
    ? `Desde S/ ${firstOption.monthlyAmount.toFixed(2)}/mes (${firstOption.months} cuotas)`
    : "";

  const caption = `${bundle.name}\nPrecio: S/ ${bundle.price.toFixed(2)}${installmentText ? `\n${installmentText}` : ""}`;

  const imagePath = `images/${bundle.image_id}.jpg`;

  if (isSimulation) {
    WhatsAppService.logMessage(
      ref,
      "outbound",
      "image",
      imagePath,
      "sent",
      bundle.id,
    );
  } else {
    const outcome = await WhatsAppService.sendImage(
      ref,
      imagePath,
      caption,
      bundle.id,
      { retry: true },
    );
    // A queued image counts as shown. The outbox row is the durable record of
    // that reply and the worker delivers it in order, so the phase must name
    // the product the customer is about to see.
    if (!outcome.ok && !outcome.queued) {
      logger.warn(
        {
          tenantId: ref.tenantId,
          channelAccountId: ref.channelAccountId,
          bundleId: bundle.id,
          kind: outcome.kind,
          reason: outcome.reason,
        },
        "Bundle image was not sent, so it is not recorded as shown",
      );
      return null;
    }
  }

  return {
    ...phase,
    sentProducts: [
      {
        name: bundle.name,
        position: 1,
        productId: bundle.id,
        price: bundle.price,
      },
    ],
    lastAction: {
      type: "showed_products",
      category: bundle.primary_category,
      productCount: 1,
      timestamp: Date.now(),
    },
  } as ConversationPhase;
}

import type {
  ConversationPhase,
  ConversationMetadata,
  TransitionResult,
  EnrichmentResult,
} from "@totem/core";
import type { IntelligenceProvider } from "@totem/intelligence";
import { transition } from "@totem/core";
import { enrichmentRegistry } from "../enrichment/index.ts";
import { applyEnrichmentToMetadata } from "../enrichment/metadata-manager.ts";
import { updateConversation } from "../store.ts";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("enrichment");
const MAX_ENRICHMENT_LOOPS = 10; // Safety limit

/**
 * Run the enrichment loop for state machine transitions.
 *
 * The state machine is pure and cannot make external calls. When it needs
 * external data (LLM, eligibility check, etc.), it returns "need_enrichment".
 * This function orchestrates the feedback loop until we get a final result.
 */
export async function runEnrichmentLoop(
  phase: ConversationPhase,
  message: string,
  metadata: ConversationMetadata,
  phoneNumber: string,
  provider: IntelligenceProvider,
  quotedContext?: {
    id: string;
    body: string;
    type: string;
    timestamp: number;
  },
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
      quotedContext,
    });

    if (result.type !== "need_enrichment") {
      if (iterations > 1) {
        logger.debug(
          { phoneNumber, iterations, finalPhase: result.nextPhase.phase },
          "Enrichment complete",
        );
      }
      return result;
    }

    logger.debug(
      {
        phoneNumber,
        enrichmentType: result.enrichment.type,
        iteration: iterations,
      },
      "Enrichment needed",
    );

    if (result.pendingPhase) {
      currentPhase = result.pendingPhase;
      updateConversation(phoneNumber, currentPhase, metadata);
    }

    const handler = enrichmentRegistry.get(result.enrichment.type);
    enrichment = await handler.execute(result.enrichment, {
      phoneNumber,
      provider,
    });

    // Apply enrichment results to metadata (e.g., DNI tracking, customer data)
    applyEnrichmentToMetadata(enrichment, result.enrichment, metadata);
  }

  // Safety: too many loops, escalate
  logger.error(
    {
      phoneNumber,
      iterations: MAX_ENRICHMENT_LOOPS,
      currentPhase: currentPhase.phase,
    },
    "Max enrichment loops exceeded",
  );
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
        message: `ERROR: Límite de bucles de enriquecimiento excedido`,
      },
      { type: "ESCALATE", reason: "enrichment_loop_exceeded" },
    ],
  };
}

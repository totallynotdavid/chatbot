import type {
  ConversationMetadata,
  ConversationPhase,
  EnrichmentResult,
  TransitionResult,
} from "@vendeya/core";
import { transition } from "@vendeya/core";
import type { IntelligenceProvider } from "@vendeya/intelligence";
import type { CatalogSnapshot, ConversationRef } from "@vendeya/types";
import { createTraceId } from "@vendeya/utils";
import { createLogger } from "../../lib/logger.ts";
import { enrichmentRegistry } from "../enrichment/index.ts";
import { applyEnrichmentToMetadata } from "../enrichment/metadata-manager.ts";
import { updateConversation } from "../store.ts";

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
  ref: ConversationRef,
  provider: IntelligenceProvider,
  quotedContext?: {
    id: string;
    body: string;
    type: string;
    timestamp: number;
  },
  context?: CatalogSnapshot,
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
      context,
    });

    if (result.type !== "need_enrichment") {
      if (iterations > 1) {
        logger.debug(
          {
            tenantId: ref.tenantId,
            phoneNumber: ref.phoneNumber,
            iterations,
            finalPhase: result.nextPhase.phase,
          },
          "Enrichment complete",
        );
      }
      return result;
    }

    logger.debug(
      {
        tenantId: ref.tenantId,
        phoneNumber: ref.phoneNumber,
        enrichmentType: result.enrichment.type,
        iteration: iterations,
      },
      "Enrichment needed",
    );

    if (result.pendingPhase) {
      currentPhase = result.pendingPhase;
      updateConversation(ref, currentPhase, metadata);
    }

    const handler = enrichmentRegistry.get(result.enrichment.type);
    enrichment = await handler.execute(result.enrichment, {
      ref,
      provider,
    });

    // e.g., DNI tracking, customer data
    applyEnrichmentToMetadata(enrichment, result.enrichment, metadata);
  }

  // Safety: too many loops, escalate
  logger.error(
    {
      tenantId: ref.tenantId,
      phoneNumber: ref.phoneNumber,
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
    events: [
      {
        type: "enrichment_limit_exceeded",
        traceId: createTraceId(),
        timestamp: Date.now(),
        payload: {
          phoneNumber: ref.phoneNumber,
          lastPhase: currentPhase.phase,
        },
      },
      {
        type: "escalation_triggered",
        traceId: createTraceId(),
        timestamp: Date.now(),
        payload: {
          phoneNumber: ref.phoneNumber,
          reason: "enrichment_loop_exceeded",
          context: {
            iterations,
            lastPhase: currentPhase.phase,
          },
        },
      },
    ],
    commands: [],
  };
}

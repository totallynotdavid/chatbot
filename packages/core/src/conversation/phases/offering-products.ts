/**
 * Offering products phase transition
 *
 * This is the main sales phase. Handles:
 * - Category extraction (via regex or LLM)
 * - Question detection and answering
 * - Product selection
 * - Purchase confirmation
 */

import type {
  ConversationPhase,
  TransitionResult,
  EnrichmentResult,
} from "../types.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import { matchCategory } from "../../matching/category-matcher.ts";
import * as S from "../../templates/sales.ts";

type OfferingProductsPhase = Extract<
  ConversationPhase,
  { phase: "offering_products" }
>;

export function transitionOfferingProducts(
  phase: OfferingProductsPhase,
  message: string,
  _metadata: unknown,
  enrichment?: EnrichmentResult,
): TransitionResult {
  const lower = message.toLowerCase();

  // First check: do we have categories loaded?
  if (!phase.availableCategories) {
    // Need to fetch categories from DB before proceeding
    return {
      type: "need_enrichment",
      enrichment: { type: "fetch_categories", segment: phase.segment },
    };
  }

  // Handle enrichment results first
  if (enrichment) {
    return handleEnrichmentResult(phase, message, enrichment);
  }

  // Try regex-based category matching first (no LLM needed)
  const matchedCategory = matchCategory(message);
  if (matchedCategory) {
    return {
      type: "update",
      nextPhase: phase, // Stay in offering_products
      commands: [
        {
          type: "TRACK_EVENT",
          event: "category_selected",
          metadata: { category: matchedCategory, method: "regex" },
        },
        { type: "SEND_IMAGES", category: matchedCategory },
      ],
    };
  }

  // Check for purchase confirmation signals
  if (isPurchaseConfirmation(lower)) {
    const variants = S.CONFIRM_PURCHASE(phase.name || "");
    return {
      type: "update",
      nextPhase: { phase: "closing", purchaseConfirmed: true },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "purchase_confirmed",
          metadata: { segment: phase.segment },
        },
        {
          type: "SEND_MESSAGE",
          text: selectVariant(variants, "CONFIRM_PURCHASE", {}).message,
        },
        {
          type: "NOTIFY_TEAM",
          channel: "agent",
          message: `Cliente confirmó interés de compra`,
        },
      ],
    };
  }

  // Check for rejection
  if (isRejection(lower)) {
    return {
      type: "update",
      nextPhase: { phase: "closing", purchaseConfirmed: false },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "offer_rejected",
          metadata: {},
        },
        {
          type: "SEND_MESSAGE",
          text: "Entendido. ¡Gracias por tu tiempo! Si cambias de opinión, aquí estaré.",
        },
      ],
    };
  }

  // Check for price concern - transition to objection handling
  if (isPriceConcern(lower)) {
    const { message: response } = selectVariant(
      S.PRICE_CONCERN.standard,
      "PRICE_CONCERN",
      {},
    );

    return {
      type: "update",
      nextPhase: {
        phase: "handling_objection",
        segment: phase.segment,
        credit: phase.credit,
        name: phase.name,
        objectionCount: 1,
      },
      commands: [{ type: "SEND_MESSAGE", text: response }],
    };
  }

  // Need LLM to understand - first detect if it's a question
  return {
    type: "need_enrichment",
    enrichment: { type: "detect_question", message },
  };
}

function handleEnrichmentResult(
  phase: OfferingProductsPhase,
  message: string,
  enrichment: EnrichmentResult,
): TransitionResult {
  // Categories fetched - update phase and continue
  if (enrichment.type === "categories_fetched") {
    const updatedPhase: OfferingProductsPhase = {
      ...phase,
      availableCategories: enrichment.categories,
    };

    // If no categories available, gracefully handle
    if (enrichment.categories.length === 0) {
      return {
        type: "update",
        nextPhase: {
          phase: "escalated",
          reason: "no_products_available",
        },
        commands: [
          {
            type: "NOTIFY_TEAM",
            channel: "agent",
            message: "No hay productos disponibles en catálogo activo",
          },
          { type: "ESCALATE", reason: "no_products_available" },
        ],
      };
    }

    // Categories loaded - return to normal processing
    // Re-process the message with categories now available
    return transitionOfferingProducts(updatedPhase, message, {}, undefined);
  }

  // Question detected - need to decide how to handle
  if (enrichment.type === "question_detected") {
    if (enrichment.isQuestion) {
      // Check if should escalate
      return {
        type: "need_enrichment",
        enrichment: { type: "should_escalate", message },
      };
    }

    // Not a question - try to extract category with LLM
    return {
      type: "need_enrichment",
      enrichment: {
        type: "extract_category",
        message,
        availableCategories: phase.availableCategories!,
      },
    };
  }

  // Escalation decision
  if (enrichment.type === "escalation_needed") {
    if (enrichment.shouldEscalate) {
      return {
        type: "update",
        nextPhase: {
          phase: "escalated",
          reason: "customer_question_requires_human",
        },
        commands: [
          {
            type: "NOTIFY_TEAM",
            channel: "agent",
            message: `Cliente tiene pregunta que requiere atención humana`,
          },
          { type: "ESCALATE", reason: "customer_question_requires_human" },
        ],
      };
    }

    // Answer the question
    return {
      type: "need_enrichment",
      enrichment: {
        type: "answer_question",
        message,
        context: {
          segment: phase.segment,
          credit: phase.credit,
          phase: "offering_products",
          availableCategories: phase.availableCategories!,
        },
      },
    };
  }

  // Question answered
  if (enrichment.type === "question_answered") {
    return {
      type: "update",
      nextPhase: phase,
      commands: [{ type: "SEND_MESSAGE", text: enrichment.answer }],
    };
  }

  // Category extracted
  if (enrichment.type === "category_extracted") {
    if (enrichment.category) {
      return {
        type: "update",
        nextPhase: phase, // Stay in offering_products
        commands: [
          {
            type: "TRACK_EVENT",
            event: "category_selected",
            metadata: { category: enrichment.category, method: "llm" },
          },
          { type: "SEND_IMAGES", category: enrichment.category },
        ],
      };
    }

    // Couldn't extract category - ask for clarification
    const { message: response } = selectVariant(
      S.ASK_PRODUCT_INTEREST,
      "ASK_PRODUCT_INTEREST",
      {},
    );

    return {
      type: "update",
      nextPhase: phase,
      commands: [{ type: "SEND_MESSAGE", text: response }],
    };
  }

  // Unknown enrichment - ask what they want
  const { message: response } = selectVariant(
    S.ASK_PRODUCT_INTEREST,
    "ASK_PRODUCT_INTEREST",
    {},
  );

  return {
    type: "update",
    nextPhase: phase,
    commands: [{ type: "SEND_MESSAGE", text: response }],
  };
}

function isPurchaseConfirmation(lower: string): boolean {
  return (
    /(quiero|me\s+interesa|lo\s+quiero|s[ií]\s*,?\s*(quiero|me\s+interesa)|confirmo|listo|dale|va)/.test(
      lower,
    ) && !/(no\s+quiero|no\s+me\s+interesa)/.test(lower)
  );
}

function isRejection(lower: string): boolean {
  return /(no\s+(quiero|me\s+interesa|gracias)|nada|paso|no\s+por\s+ahora)/.test(
    lower,
  );
}

function isPriceConcern(lower: string): boolean {
  return /(caro|muy\s+caro|precio|cuesta\s+mucho|no\s+puedo\s+pagar|no\s+tengo\s+plata|presupuesto)/.test(
    lower,
  );
}

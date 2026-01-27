import type {
  ConversationPhase,
  TransitionResult,
  EnrichmentResult,
  ConversationMetadata,
} from "../types.ts";
import { createTraceId } from "@totem/utils";
import { selectVariant } from "../../messaging/variation-selector.ts";
import { isAffirmative } from "../../validation/affirmation.ts";
import { matchCategory } from "../../matching/category-matcher.ts";
import * as S from "../../templates/sales.ts";

type ConfirmingSelectionPhase = Extract<
  ConversationPhase,
  { phase: "confirming_selection" }
>;

export function transitionConfirmingSelection(
  phase: ConfirmingSelectionPhase,
  message: string,
  _metadata: ConversationMetadata,
  enrichment?: EnrichmentResult,
): TransitionResult {
  // Use LLM recovery if available
  if (enrichment?.type === "recovery_response") {
    return {
      type: "update",
      nextPhase: phase,
      commands: [{ type: "SEND_MESSAGE", text: enrichment.text }],
    };
  }

  const lower = message.toLowerCase();

  // Check for confirmation
  if (isAffirmative(message)) {
    const variants = S.CONFIRM_PURCHASE(phase.name || "");
    const { message: confirmMsgs } = selectVariant(
      variants,
      "CONFIRM_PURCHASE",
      {},
    );

    return {
      type: "update",
      nextPhase: { phase: "closing", purchaseConfirmed: true },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "purchase_confirmed",
          metadata: {
            segment: phase.segment,
            productId: phase.selectedProduct.productId,
            productName: phase.selectedProduct.name,
            price: phase.selectedProduct.price,
          },
        },
        ...confirmMsgs.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
      ],
      events: [
        {
          type: "purchase_confirmed",
          traceId: createTraceId(),
          timestamp: Date.now(),
          payload: {
            amount: phase.selectedProduct.price,
            clientName: phase.name,
            phoneNumber:
              _metadata?.phoneNumber?.replace(/\D/g, "") || "unknown",
            dni: _metadata?.dni || "unknown",
            productId: phase.selectedProduct.productId,
            productName: phase.selectedProduct.name,
          },
        },
      ],
    };
  }

  // Check for rejection or want to explore more
  if (isRejectionOrExplore(lower)) {
    return {
      type: "update",
      nextPhase: {
        phase: "offering_products",
        segment: phase.segment,
        credit: phase.credit,
        name: phase.name,
        interestedProduct: {
          name: phase.selectedProduct.name,
          price: phase.selectedProduct.price,
          productId: phase.selectedProduct.productId,
          exploredCategoriesCount: 0,
        },
      },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "returned_to_browsing",
          metadata: {
            fromProduct: phase.selectedProduct.name,
            productId: phase.selectedProduct.productId,
            price: phase.selectedProduct.price,
          },
        },
        {
          type: "SEND_MESSAGE",
          text: "Sin problema. ¿Qué te gustaría ver?",
        },
      ],
    };
  }

  // Check if user is asking for a different category
  const matchedCategory = matchCategory(message);
  if (matchedCategory) {
    return {
      type: "update",
      nextPhase: {
        phase: "offering_products",
        segment: phase.segment,
        credit: phase.credit,
        name: phase.name,
        // Reset interested product if they explicitly switched category
        interestedProduct: {
          name: phase.selectedProduct.name,
          price: phase.selectedProduct.price,
          productId: phase.selectedProduct.productId,
          exploredCategoriesCount: 1,
        },
      },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "category_switched_from_confirmation",
          metadata: {
            category: matchedCategory,
            fromProduct: phase.selectedProduct.name,
          },
        },
        { type: "SEND_IMAGES", category: matchedCategory },
      ],
    };
  }

  // Unclear response, re-ask with LLM help
  return {
    type: "need_enrichment",
    enrichment: {
      type: "recover_unclear_response",
      message,
      context: {
        phase: "confirming_selection",
        lastQuestion: `¿Confirmas tu elección de ${phase.selectedProduct.name}?`,
        expectedOptions: ["Sí", "Quiero ver otros"],
      },
    },
    pendingPhase: phase,
  };
}

function isRejectionOrExplore(lower: string): boolean {
  return /(no|todav[ií]a\s+no|quiero\s+ver\s+(otros?|m[aá]s)|mejor\s+no|otro|m[aá]s\s+opciones?)/.test(
    lower,
  );
}

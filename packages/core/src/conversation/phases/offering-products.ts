import type {
  ConversationPhase,
  TransitionResult,
  EnrichmentResult,
} from "../types.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import { matchCategory } from "../../matching/category-matcher.ts";
import { matchAllProducts } from "../../matching/product-selection.ts";
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

  if (enrichment) {
    return handleEnrichmentResult(phase, message, enrichment);
  }

  // If we have sent products, check for product match first (even without explicit interest phrase)
  // After showing products and asking "¿Alguno te interesa?", any mention is implicit interest
  if (phase.sentProducts && phase.sentProducts.length > 0) {
    const allMatches = matchAllProducts(message, phase.sentProducts);

    if (allMatches.length === 1) {
      // Unique match, confirm specific product
      const selected = allMatches[0];
      if (selected) {
        const priceText = selected.price
          ? ` (S/ ${selected.price.toFixed(2)})`
          : "";
        const confirmationText = `Perfecto ${phase.name} 😊\n\nHas elegido: ${selected.name}${priceText}`;
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
              type: "SEND_MESSAGE",
              text: confirmationText,
            },
            {
              type: "TRACK_EVENT",
              event: "product_selected",
              metadata: {
                segment: phase.segment,
                productId: selected.productId,
                productName: selected.name,
                price: selected.price,
              },
            },
            ...confirmMsgs.slice(1).map((text) => ({
              type: "SEND_MESSAGE" as const,
              text,
            })),
            {
              type: "NOTIFY_TEAM",
              channel: "agent",
              message: `Cliente seleccionó: ${selected.name}${priceText}`,
            },
          ],
        };
      }
    }

    if (allMatches.length > 1) {
      // Ambiguous, ask for clarification
      const options = allMatches
        .map((p, idx) => {
          const priceText = p.price ? ` - S/ ${p.price.toFixed(2)}` : "";
          return `${idx + 1}. ${p.name}${priceText}`;
        })
        .join("\n");

      return {
        type: "update",
        nextPhase: phase,
        commands: [
          {
            type: "SEND_MESSAGE",
            text: `Tenemos varios modelos que coinciden. ¿Cuál te interesa?\n\n${options}`,
          },
        ],
      };
    }

    // No matches found in sent products, continue with normal flow below
  }

  // Check for explicit product selection with interest phrases
  if (isProductSelection(lower)) {
    // Generic confirmation (no products tracked or no match)
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
          event: "product_selected_generic",
          metadata: { segment: phase.segment },
        },
        ...confirmMsgs.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
        {
          type: "NOTIFY_TEAM",
          channel: "agent",
          message: `Cliente seleccionó un producto`,
        },
      ],
    };
  }

  // Check for category matching
  const matchedCategory = matchCategory(message);
  if (matchedCategory) {
    // If we already showed this exact category, treat as product interest confirmation
    if (phase.lastShownCategory === matchedCategory) {
      const variants = S.CONFIRM_PURCHASE(phase.name || "");
      const { message } = selectVariant(variants, "CONFIRM_PURCHASE", {});

      return {
        type: "update",
        nextPhase: { phase: "closing", purchaseConfirmed: true },
        commands: [
          {
            type: "TRACK_EVENT",
            event: "product_confirmed_via_category_repeat",
            metadata: { category: matchedCategory },
          },
          ...message.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
          {
            type: "NOTIFY_TEAM",
            channel: "agent",
            message: `Cliente confirmó interés en ${matchedCategory}`,
          },
        ],
      };
    }

    // Different category, allow switch
    return {
      type: "update",
      nextPhase: { ...phase, lastShownCategory: matchedCategory },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "category_selected",
          metadata: {
            category: matchedCategory,
            method: "regex",
            previousCategory: phase.lastShownCategory,
          },
        },
        { type: "SEND_IMAGES", category: matchedCategory },
      ],
    };
  }

  // Check for "show me other products" patterns
  if (isRequestingOtherOptions(lower)) {
    const categoryDisplayNames = phase.categoryDisplayNames || [];
    const productList =
      categoryDisplayNames.length > 0
        ? categoryDisplayNames.join(", ")
        : "nuestros productos disponibles";

    const { message: messages } = selectVariant(
      S.ASK_PRODUCT_INTEREST(productList),
      "ASK_PRODUCT_INTEREST",
      {},
    );

    return {
      type: "update",
      nextPhase: phase,
      commands: messages.map((text) => ({
        type: "SEND_MESSAGE" as const,
        text,
      })),
    };
  }

  // Check for purchase confirmation signals (only generic ones like "sí, quiero", "confirmo")
  // Specific product mentions are handled by isProductSelection above
  if (isPurchaseConfirmation(lower)) {
    const variants = S.CONFIRM_PURCHASE(phase.name || "");
    const { message } = selectVariant(variants, "CONFIRM_PURCHASE", {});

    return {
      type: "update",
      nextPhase: { phase: "closing", purchaseConfirmed: true },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "purchase_confirmed",
          metadata: { segment: phase.segment },
        },
        ...message.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
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

  // Check for price concern, transition to objection handling
  if (isPriceConcern(lower)) {
    const { message } = selectVariant(
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
      commands: message.map((text) => ({
        type: "SEND_MESSAGE" as const,
        text,
      })),
    };
  }

  // Need LLM to understand, first detect if it's a question
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
  if (enrichment.type === "question_detected") {
    if (enrichment.isQuestion) {
      // Check if should escalate
      return {
        type: "need_enrichment",
        enrichment: { type: "should_escalate", message },
      };
    }

    // Not a question, try to extract category with LLM
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
  if (enrichment.type === "category_extracted" && enrichment.category) {
    // If LLM extracted same category we already showed, treat as product confirmation
    if (phase.lastShownCategory === enrichment.category) {
      const variants = S.CONFIRM_PURCHASE(phase.name || "");
      const { message } = selectVariant(variants, "CONFIRM_PURCHASE", {});

      return {
        type: "update",
        nextPhase: { phase: "closing", purchaseConfirmed: true },
        commands: [
          {
            type: "TRACK_EVENT",
            event: "product_confirmed_via_llm_category",
            metadata: { category: enrichment.category },
          },
          ...message.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
          {
            type: "NOTIFY_TEAM",
            channel: "agent",
            message: `Cliente confirmó interés en ${enrichment.category}`,
          },
        ],
      };
    }

    // Different category, show new products
    return {
      type: "update",
      nextPhase: { ...phase, lastShownCategory: enrichment.category },
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

  // Fallback: couldn't extract category or unknown enrichment, ask for clarification
  const categoryDisplayNames = phase.categoryDisplayNames || [];
  const productList =
    categoryDisplayNames.length > 0
      ? categoryDisplayNames.join(", ")
      : "nuestros productos disponibles";

  const { message: messages } = selectVariant(
    S.ASK_PRODUCT_INTEREST(productList),
    "ASK_PRODUCT_INTEREST",
    {},
  );

  return {
    type: "update",
    nextPhase: phase,
    commands: messages.map((text) => ({
      type: "SEND_MESSAGE" as const,
      text,
    })),
  };
}

function isProductSelection(lower: string): boolean {
  // Detect when user expresses interest in a specific product
  // Examples: "me interesa el samsung", "quiero el primero", "me llama la atención"
  const hasInterestPhrase =
    /(me\s+(interesa|gusta|llama\s+la\s+atenci[oó]n|parece\s+bien|convence)|quiero|quisiera|prefiero|elijo)/.test(
      lower,
    );
  const hasSpecifier =
    /(el|la|los|las)\s+(primer|segund|tercer|cuart|samsung|galaxy|lg|mabe|iphone|huawei|xiaomi|motorola|\w+\s+(pulgadas?|gb|inch))/.test(
      lower,
    );

  return hasInterestPhrase && hasSpecifier;
}

function isRequestingOtherOptions(lower: string): boolean {
  return /(otros?|otras?|m[aá]s\s+(opciones?|productos?)|algo\s+m[aá]s|qu[eé]\s+m[aá]s\s+tienes?)/.test(
    lower,
  );
}

function isPurchaseConfirmation(lower: string): boolean {
  // Only match generic confirmations, NOT specific product interest
  // "me interesa el samsung" should be handled by isProductSelection
  return (
    /(^|\s)(s[ií]|confirmo|listo|dale|va|quiero\s+comprar)($|\s|,)/.test(
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

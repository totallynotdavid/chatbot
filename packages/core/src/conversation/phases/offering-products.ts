import type {
  ConversationPhase,
  TransitionResult,
  EnrichmentResult,
  Command,
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
  quotedContext?: {
    id: string;
    body: string;
    type: string;
    timestamp: number;
  },
): TransitionResult {
  const lower = message.toLowerCase();

  if (enrichment) {
    return handleEnrichmentResult(phase, message, enrichment);
  }

  // Handle quoted message context, user is responding to a specific product
  if (quotedContext && phase.sentProducts && phase.sentProducts.length > 0) {
    let quotedProduct: any = null;

    if (quotedContext.type === "image" && quotedContext.body.includes("/")) {
      const imageFilename = quotedContext.body.split("/").pop()?.split(".")[0];
      if (imageFilename) {
        quotedProduct = phase.sentProducts.find((product) =>
          product.productId?.includes(imageFilename),
        );
      }
    } else {
      // For text messages, match by message content
      quotedProduct = phase.sentProducts.find((product) =>
        quotedContext.body.toLowerCase().includes(product.name.toLowerCase()),
      );
    }

    if (quotedProduct) {
      const priceText = quotedProduct.price
        ? ` (S/ ${quotedProduct.price.toFixed(2)})`
        : "";

      const confirmationText = `Perfecto 😊\n\nHas elegido: ${quotedProduct.name}${priceText}\n\n¿Confirmas tu elección?`;

      return {
        type: "update",
        nextPhase: {
          phase: "confirming_selection",
          segment: phase.segment,
          credit: phase.credit,
          name: phase.name || "",
          selectedProduct: {
            name: quotedProduct.name,
            price: quotedProduct.price || 0,
            productId: quotedProduct.productId || "",
          },
        },
        commands: [
          {
            type: "SEND_MESSAGE",
            text: confirmationText,
          },
        ],
      };
    } else {
      // No product found matching quoted message, continue to normal flow
    }
  }

  // If we have sent products, check for product match first (even without explicit interest phrase)
  // After showing products and asking "¿Alguno te interesa?", any mention is implicit interest
  if (phase.sentProducts && phase.sentProducts.length > 0) {
    const allMatches = matchAllProducts(message, phase.sentProducts);

    if (allMatches.length === 1) {
      // Unique match, transition to confirmation gate
      const selected = allMatches[0];
      if (selected) {
        const priceText = selected.price
          ? ` (S/ ${selected.price.toFixed(2)})`
          : "";

        // Check if this is re-selecting the interested product or new selection
        const isReselection =
          phase.interestedProduct &&
          phase.interestedProduct.productId === selected.productId;

        const confirmationText = isReselection
          ? `Perfecto ${phase.name} 😊\n\nRetomemos: ${selected.name}${priceText}\n\n¿Confirmas tu elección?`
          : `Perfecto ${phase.name} 😊\n\nHas elegido: ${selected.name}${priceText}\n\n¿Confirmas tu elección?`;

        return {
          type: "update",
          nextPhase: {
            phase: "confirming_selection",
            segment: phase.segment,
            credit: phase.credit,
            name: phase.name,
            selectedProduct: {
              name: selected.name,
              price: selected.price || 0,
              productId: selected.productId || "",
            },
          },
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
            {
              type: "NOTIFY_TEAM",
              channel: "agent",
              message: `Cliente seleccionó: ${selected.name}${priceText} - esperando confirmación`,
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

  // If user expresses interest without context (no sentProducts), ask what they want to see
  if (isProductSelection(lower)) {
    const categoryDisplayNames = phase.categoryDisplayNames || [];
    const productList =
      categoryDisplayNames.length > 0
        ? categoryDisplayNames.join(", ")
        : "nuestros productos disponibles";

    return {
      type: "update",
      nextPhase: phase,
      commands: [
        {
          type: "SEND_MESSAGE",
          text: `¿Qué producto te interesa? Tenemos: ${productList}`,
        },
      ],
    };
  }

  // Check for category matching
  const matchedCategory = matchCategory(message);
  if (matchedCategory) {
    // If same category, ask which specific product
    if (phase.lastShownCategory === matchedCategory) {
      return {
        type: "update",
        nextPhase: phase,
        commands: [
          {
            type: "SEND_MESSAGE",
            text: "¿Cuál de los productos te interesa? Puedes decir 'el primero', 'el segundo', etc.",
          },
        ],
      };
    }

    // Different category, allow switch
    const exploredCount = phase.interestedProduct
      ? phase.interestedProduct.exploredCategoriesCount + 1
      : 0;

    const updatedPhase = {
      ...phase,
      lastShownCategory: matchedCategory,
      interestedProduct: phase.interestedProduct
        ? {
            ...phase.interestedProduct,
            exploredCategoriesCount: exploredCount,
          }
        : undefined,
    };

    const commands: Command[] = [
      {
        type: "TRACK_EVENT",
        event: "category_selected",
        metadata: {
          category: matchedCategory,
          method: "regex",
          previousCategory: phase.lastShownCategory,
          exploredCount,
        },
      },
      { type: "SEND_IMAGES", category: matchedCategory },
    ];

    // Send reminder after viewing 2 different categories
    if (exploredCount === 2 && phase.interestedProduct) {
      const priceText = ` (S/ ${phase.interestedProduct.price.toFixed(2)})`;
      commands.push({
        type: "SEND_MESSAGE",
        text: `Por cierto ${phase.name}, recuerda que te interesaba el ${phase.interestedProduct.name}${priceText}. ¿Quieres confirmarlo?`,
      });
    }

    return {
      type: "update",
      nextPhase: updatedPhase,
      commands,
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

  // Generic confirmations without product context - ask what they want
  if (isPurchaseConfirmation(lower)) {
    const categoryDisplayNames = phase.categoryDisplayNames || [];
    const productList =
      categoryDisplayNames.length > 0
        ? categoryDisplayNames.join(", ")
        : "nuestros productos disponibles";

    return {
      type: "update",
      nextPhase: phase,
      commands: [
        {
          type: "SEND_MESSAGE",
          text: `¡Perfecto! ¿Qué te gustaría ver? Tenemos: ${productList}`,
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
    // If LLM extracted same category we already showed, ask which product
    if (phase.lastShownCategory === enrichment.category) {
      return {
        type: "update",
        nextPhase: phase,
        commands: [
          {
            type: "SEND_MESSAGE",
            text: "¿Cuál de los productos te interesa? Puedes decir 'el primero', 'el segundo', etc.",
          },
        ],
      };
    }

    // Different category, show new products
    const exploredCount = phase.interestedProduct
      ? phase.interestedProduct.exploredCategoriesCount + 1
      : 0;

    const updatedPhase = {
      ...phase,
      lastShownCategory: enrichment.category,
      interestedProduct: phase.interestedProduct
        ? {
            ...phase.interestedProduct,
            exploredCategoriesCount: exploredCount,
          }
        : undefined,
    };

    const commands: Command[] = [
      {
        type: "TRACK_EVENT",
        event: "category_selected",
        metadata: {
          category: enrichment.category,
          method: "llm",
          exploredCount,
        },
      },
      { type: "SEND_IMAGES", category: enrichment.category },
    ];

    // Send reminder after viewing 2 different categories
    if (exploredCount === 2 && phase.interestedProduct) {
      const priceText = ` (S/ ${phase.interestedProduct.price.toFixed(2)})`;
      commands.push({
        type: "SEND_MESSAGE",
        text: `Por cierto ${phase.name}, recuerda que te interesaba el ${phase.interestedProduct.name}${priceText}. ¿Quieres confirmarlo?`,
      });
    }

    return {
      type: "update",
      nextPhase: updatedPhase,
      commands,
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
  return /(caro|muy\s+caro|precio|cuesta\s+mucho|no\s+puedo\s+pagar|no\s+tengo\s+tanta\s+plata|no\s+tengo\s+mucha\s+plata|no\s+tengo\s+suficiente\s+plata|no\s+tengo\s+plata|no\s+me\s+alcanza|no\s+tengo\s+ese\s+dinero|no\s+tengo\s+dinero|fuera\s+de\s+mi\s+presupuesto|fuera\s+de\s+presupuesto)/.test(
    lower,
  );
}

import type {
  ConversationPhase,
  TransitionResult,
  EnrichmentResult,
  Command,
} from "../types.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import { matchCategory } from "../../matching/category-matcher.ts";
import { matchGroup } from "../../matching/group-matcher.ts";
import { matchAllProducts } from "../../matching/product-selection.ts";
import { isAffirmative } from "../../validation/affirmation.ts";
import { CATEGORY_GROUPS, CATEGORIES, type CategoryKey } from "@totem/types";
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
            text: `Perfecto 😊 Has elegido: ${quotedProduct.name}${priceText}`,
          },
          {
            type: "SEND_MESSAGE",
            text: "¿Confirmas tu elección?",
          },
        ],
      };
    }
  }

  if (
    isAffirmative(message) &&
    phase.sentProducts &&
    phase.sentProducts.length > 0 &&
    phase.lastAction?.type === "showed_products"
  ) {
    if (phase.sentProducts.length === 1) {
      const product = phase.sentProducts[0];
      if (!product) {
        // Safety check - should never happen but satisfies TypeScript
        return {
          type: "update",
          nextPhase: phase,
          commands: [],
        };
      }

      const priceText = product.price
        ? ` (S/ ${product.price.toFixed(2)})`
        : "";

      return {
        type: "update",
        nextPhase: {
          phase: "confirming_selection",
          segment: phase.segment,
          credit: phase.credit,
          name: phase.name,
          selectedProduct: {
            name: product.name,
            price: product.price || 0,
            productId: product.productId || "",
          },
        },
        commands: [
          {
            type: "SEND_MESSAGE",
            text: `Perfecto 😊 Has elegido: ${product.name}${priceText}.`,
          },
          {
            type: "SEND_MESSAGE",
            text: "¿Confirmas tu elección?",
          },
        ],
      };
    }

    const productList = phase.sentProducts
      .map(
        (p, idx) =>
          `${idx + 1}. ${p.name}${p.price ? ` - S/ ${p.price.toFixed(2)}` : ""}`,
      )
      .join("\n");

    return {
      type: "update",
      nextPhase: phase,
      commands: [
        {
          type: "SEND_MESSAGE",
          text: "¡Genial! ¿Te interesa alguno de los que ya te mostré?",
        },
        {
          type: "SEND_MESSAGE",
          text: `Por ahora te mostré estos:\n${productList}`,
        },
        {
          type: "SEND_MESSAGE",
          text: "¿O quieres ver otros?",
        },
      ],
    };
  }

  if (phase.sentProducts && phase.sentProducts.length > 0) {
    const allMatches = matchAllProducts(message, phase.sentProducts);

    if (allMatches.length === 1) {
      const selected = allMatches[0];
      if (selected) {
        const priceText = selected.price
          ? ` (S/ ${selected.price.toFixed(2)})`
          : "";

        const isReselection =
          phase.interestedProduct &&
          phase.interestedProduct.productId === selected.productId;

        const confirmationMsg1 = isReselection
          ? `Perfecto ${phase.name} 😊 Retomemos: ${selected.name}${priceText}`
          : `Perfecto ${phase.name} 😊 Has elegido: ${selected.name}${priceText}`;

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
              text: confirmationMsg1,
            },
            {
              type: "SEND_MESSAGE",
              text: "¿Confirmas tu elección?",
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
      return {
        type: "update",
        nextPhase: phase,
        commands: [
          {
            type: "SEND_MESSAGE",
            text: formatDisambiguationMessage(allMatches),
          },
        ],
      };
    }
  }

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

  // Progressive disclosure: Check if user selected a group (step 1)
  const matchedGroup = matchGroup(message);
  if (matchedGroup && !phase.exploringGroup) {
    const groupConfig = CATEGORY_GROUPS[matchedGroup];
    const groupCategorySet = new Set(groupConfig.categories);
    const availableInGroup =
      phase.availableCategories?.filter((cat) =>
        groupCategorySet.has(cat as CategoryKey),
      ) || [];

    if (availableInGroup.length === 0) {
      // Group exists but no products available
      return {
        type: "update",
        nextPhase: phase,
        commands: [
          {
            type: "SEND_MESSAGE",
            text: `Uy, en ${groupConfig.display.toLowerCase()} no tengo productos disponibles ahora 😕. ¿Te muestro otras opciones?`,
          },
        ],
      };
    }

    // Show categories within the group
    const categoryNames = availableInGroup
      .map((key) => CATEGORIES[key as CategoryKey]?.display.toLowerCase())
      .filter(Boolean);

    const categoryList =
      categoryNames.length === 1
        ? categoryNames[0]
        : categoryNames.length === 2
          ? `${categoryNames[0]} o ${categoryNames[1]}`
          : categoryNames.slice(0, -1).join(", ") +
            ` o ${categoryNames[categoryNames.length - 1]}`;

    return {
      type: "update",
      nextPhase: {
        ...phase,
        currentGroup: matchedGroup,
        exploringGroup: true,
      },
      commands: [
        {
          type: "SEND_MESSAGE",
          text: `¡Perfecto! En ${groupConfig.display.toLowerCase()} tengo ${categoryList}. ¿Cuál te interesa más? 😊`,
        },
      ],
    };
  }

  const matchedCategory = matchCategory(message);
  if (matchedCategory) {
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
  if (enrichment.type === "recovery_response") {
    return {
      type: "update",
      nextPhase: phase,
      commands: [{ type: "SEND_MESSAGE", text: enrichment.text }],
    };
  }

  if (enrichment.type === "question_detected") {
    if (enrichment.isQuestion) {
      return {
        type: "need_enrichment",
        enrichment: { type: "should_escalate", message },
      };
    }
  }

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

  if (enrichment.type === "question_answered") {
    return {
      type: "update",
      nextPhase: phase,
      commands: [{ type: "SEND_MESSAGE", text: enrichment.answer }],
    };
  }

  // Fallback: couldn't extract category or unknown enrichment, ask for clarification
  return {
    type: "need_enrichment",
    enrichment: {
      type: "recover_unclear_response",
      message,
      context: {
        phase: "offering_products",
        lastQuestion: "¿Alguno de nuestros productos te interesa?",
        expectedOptions: phase.categoryDisplayNames || [],
      },
    },
    pendingPhase: phase,
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

function formatDisambiguationMessage(
  matches: { name: string; price?: number }[],
): string {
  if (matches.length === 0)
    return "¿Podrías darme más detalles del que buscas? Me salen varias opciones.";

  if (matches.length === 2) {
    const [p1, p2] = matches;
    if (!p1 || !p2)
      return "¿Podrías darme más detalles del que buscas? Me salen varias opciones.";

    const price1 = p1.price ? ` (S/ ${p1.price.toFixed(2)})` : "";
    const price2 = p2.price ? ` (S/ ${p2.price.toFixed(2)})` : "";
    return `¡Claro! Tengo el ${p1.name}${price1} y el ${p2.name}${price2}. ¿Cuál te gustaría más?`;
  }

  if (matches.length === 3) {
    const [p1, p2, p3] = matches;
    if (!p1 || !p2 || !p3)
      return "¿Podrías darme más detalles del que buscas? Me salen varias opciones.";

    const pr1 = p1.price ? ` (S/ ${p1.price.toFixed(2)})` : "";
    const pr2 = p2.price ? ` (S/ ${p2.price.toFixed(2)})` : "";
    const pr3 = p3.price ? ` (S/ ${p3.price.toFixed(2)})` : "";
    return `Tengo estas tres opciones: el ${p1.name}${pr1}, el ${p2.name}${pr2} y el ${p3.name}${pr3}. ¿Cuál te interesa?`;
  }

  // Fallback for 4+ matches: use a conversational list
  const options = matches
    .map((p, idx) => {
      const priceText = p.price ? ` - S/ ${p.price.toFixed(2)}` : "";
      return `${idx + 1}. ${p.name}${priceText}`;
    })
    .join("\n");

  return `Tenemos varios modelos que coinciden. ¿Cuál te interesa?\n\n${options}`;
}

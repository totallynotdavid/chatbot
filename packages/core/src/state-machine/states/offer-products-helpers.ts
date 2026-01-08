import type { StateOutput } from "../types.ts";
import * as S from "../../templates/sales.ts";
import {
  selectVariant,
  selectVariantWithContext,
} from "../../messaging/variation-selector.ts";
import { matchProductSelection } from "../../matching/product-selection.ts";
import { detectFrustration } from "../../messaging/context-analyzer.ts";

export function handleCategoryExtraction(context: any): StateOutput | null {
  if (!context.extractedCategory) return null;

  return {
    nextState: "OFFER_PRODUCTS",
    commands: [
      {
        type: "SEND_IMAGES",
        category: context.extractedCategory,
        productIds: [],
      },
      {
        type: "TRACK_EVENT",
        eventType: "products_offered",
        metadata: {
          category: context.extractedCategory,
          segment: context.segment,
          extractionMethod: context.usedLLM ? "llm" : "matcher",
        },
      },
    ],
    updatedContext: {
      offeredCategory: context.extractedCategory,
      lastInterestCategory: context.extractedCategory,
    },
  };
}

export function handleLLMQuestion(context: any): StateOutput | null {
  if (!context.llmDetectedQuestion) return null;

  if (context.llmRequiresHuman) {
    return {
      nextState: "ESCALATED",
      commands: [
        {
          type: "ESCALATE",
          reason: "complex_question_requires_human",
        },
        {
          type: "NOTIFY_TEAM",
          channel: "agent",
          message: `Cliente ${context.phoneNumber} pregunta sobre detalles financieros`,
        },
      ],
      updatedContext: {},
    };
  }

  return {
    nextState: "OFFER_PRODUCTS",
    commands: [
      {
        type: "SEND_MESSAGE",
        content: context.llmGeneratedAnswer || "Déjame explicarte...",
      },
      {
        type: "SEND_MESSAGE",
        content:
          "¿Qué producto te interesa? Tenemos celulares, cocinas, refrigeradoras, TVs y termas.",
      },
    ],
    updatedContext: {},
  };
}

export function handleProductSelection(
  message: string,
  context: any,
): StateOutput | null {
  if (!context.sentProducts || context.sentProducts.length === 0) return null;

  const selectedProduct = matchProductSelection(message, context.sentProducts);
  if (!selectedProduct) return null;

  const { message: confirmMsg, updatedContext: variantCtx } = selectVariant(
    S.CONFIRM_PURCHASE,
    "CONFIRM_PURCHASE",
    context,
  );

  return {
    nextState: "CLOSING",
    commands: [
      {
        type: "SEND_MESSAGE",
        content: confirmMsg,
      },
      {
        type: "NOTIFY_TEAM",
        channel: "sales",
        message: `Cliente ${context.phoneNumber} seleccionó "${selectedProduct.name}" (${context.offeredCategory}) (Mensaje: "${message}")`,
      },
      {
        type: "TRACK_EVENT",
        eventType: "purchase_intent_confirmed",
        metadata: {
          category: context.offeredCategory,
          segment: context.segment,
          selectionType: "smart_match",
          selectedProduct: selectedProduct.name,
          userMessage: message,
        },
      },
    ],
    updatedContext: { purchaseConfirmed: true, ...variantCtx },
  };
}

export function handlePurchaseConfirmation(
  message: string,
  context: any,
): StateOutput | null {
  const lower = message.toLowerCase();

  const isInterestPhrase =
    /\b(me interesa|interesad|lo quiero|lo compro|me lo llevo|comprar|comprarlo)\b/.test(
      lower,
    );
  const isOrdinalSelection = /\b(primer|segund|tercer|cuart|quint)\w*/.test(
    lower,
  );
  const isAffirmative = /\b(s[ií]|ok|dale|perfecto|vale|bueno)\b/.test(lower);

  if (
    !context.offeredCategory ||
    (!isInterestPhrase && !isOrdinalSelection && !isAffirmative)
  ) {
    return null;
  }

  const { message: confirmMsg, updatedContext: variantCtx } = selectVariant(
    S.CONFIRM_PURCHASE,
    "CONFIRM_PURCHASE",
    context,
  );

  return {
    nextState: "CLOSING",
    commands: [
      {
        type: "SEND_MESSAGE",
        content: confirmMsg,
      },
      {
        type: "NOTIFY_TEAM",
        channel: "sales",
        message: `Cliente ${context.phoneNumber} confirmó interés de compra en ${context.offeredCategory || "productos"} (Mensaje: "${message}")`,
      },
      {
        type: "TRACK_EVENT",
        eventType: "purchase_intent_confirmed",
        metadata: {
          category: context.offeredCategory,
          segment: context.segment,
          selectionType: isOrdinalSelection ? "ordinal" : "phrase",
        },
      },
    ],
    updatedContext: { purchaseConfirmed: true, ...variantCtx },
  };
}

export function handlePriceObjection(
  message: string,
  context: any,
): StateOutput | null {
  const lower = message.toLowerCase();
  if (!/(caro|costoso|precio|plata|dinero|pagar)/.test(lower)) return null;

  const frustrated = detectFrustration(message);
  const { message: priceMsg, updatedContext: variantCtx } =
    selectVariantWithContext(S.PRICE_CONCERN, "PRICE_CONCERN", context, {
      frustrated,
    });

  return {
    nextState: "OFFER_PRODUCTS",
    commands: [
      {
        type: "SEND_MESSAGE",
        content: priceMsg,
      },
    ],
    updatedContext: {
      isFrustrated: frustrated,
      lastBotMessageTime: new Date().toISOString(),
      ...variantCtx,
    },
  };
}

export function handleUncertainty(
  message: string,
  context: any,
): StateOutput | null {
  const lower = message.toLowerCase();
  const isUncertain =
    /(no\s+estoy\s+seguro|no\s+s[eé]|nose|mmm|ehh|tal\s+vez)/.test(lower);

  if (!isUncertain) return null;

  let responseMsg = "";
  if (context.offeredCategory) {
    responseMsg =
      "¿Te gustaría llevarte alguno de los que te mostré o prefieres ver otra cosa?";
  } else {
    const { message: interestMsg } = selectVariant(
      S.ASK_PRODUCT_INTEREST,
      "ASK_PRODUCT_INTEREST",
      context,
    );
    responseMsg = interestMsg;
  }

  return {
    nextState: "OFFER_PRODUCTS",
    commands: [
      {
        type: "SEND_MESSAGE",
        content: responseMsg,
      },
    ],
    updatedContext: {},
  };
}

export function handleRejection(
  message: string,
  context: any,
): StateOutput | null {
  const lower = message.toLowerCase();
  if (!/\b(no|nada|no gracias|paso)\b/.test(lower)) return null;

  if (context.segment === "gaso") {
    const { message: objectionMsg, updatedContext: variantCtx } = selectVariant(
      S.KITCHEN_OBJECTION_RESPONSE,
      "KITCHEN_OBJECTION_RESPONSE",
      context,
    );
    return {
      nextState: "HANDLE_OBJECTION",
      commands: [
        {
          type: "SEND_MESSAGE",
          content: objectionMsg,
        },
      ],
      updatedContext: { objectionCount: 1, ...variantCtx },
    };
  }

  return {
    nextState: "CLOSING",
    commands: [
      {
        type: "SEND_MESSAGE",
        content: `Entiendo, sin problema. Si más adelante cambias de opinión, aquí estaré.`,
      },
    ],
    updatedContext: {},
  };
}

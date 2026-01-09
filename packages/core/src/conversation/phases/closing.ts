import type {
  ConversationPhase,
  TransitionResult,
  ConversationMetadata,
  EnrichmentResult,
} from "../types.ts";

type ClosingPhase = Extract<ConversationPhase, { phase: "closing" }>;

export function transitionClosing(
  phase: ClosingPhase,
  message: string,
  metadata: ConversationMetadata,
  enrichment?: EnrichmentResult,
): TransitionResult {
  const normalized = message.toLowerCase().trim();

  // Detect new purchase intent
  const newPurchaseKeywords = [
    "también quiero",
    "también quisiera",
    "y si compro",
    "y un",
    "y una",
    "otro producto",
    "otra cosa",
    "adicional",
    "además",
  ];
  const hasNewPurchaseIntent = newPurchaseKeywords.some((kw) =>
    normalized.includes(kw),
  );

  if (hasNewPurchaseIntent && metadata.segment && metadata.credit) {
    return {
      type: "update",
      nextPhase: {
        phase: "offering_products",
        segment: metadata.segment,
        credit: metadata.credit,
        name: metadata.name || "",
      },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "additional_purchase_intent",
        },
        {
          type: "SEND_MESSAGE",
          text: "¡Claro! Te puedo mostrar más opciones. ¿Qué categoría te interesa?",
        },
      ],
    };
  }

  // Detect if it's a question, need enrichment
  if (!enrichment) {
    return {
      type: "need_enrichment",
      enrichment: { type: "detect_question", message },
    };
  }

  // Handle question detection result
  if (enrichment.type === "question_detected" && enrichment.isQuestion) {
    // Questions need answers
    return {
      type: "need_enrichment",
      enrichment: {
        type: "answer_question",
        message,
        context: {
          segment: metadata.segment,
          credit: metadata.credit,
          phase: "post_sale",
          availableCategories: [],
        },
      },
      pendingPhase: {
        phase: "closing",
        purchaseConfirmed: phase.purchaseConfirmed,
        subPhase: "post_sale_support",
      },
    };
  }

  // Handle question answered
  if (enrichment.type === "question_answered") {
    return {
      type: "update",
      nextPhase: {
        phase: "closing",
        purchaseConfirmed: phase.purchaseConfirmed,
        subPhase: "post_sale_support",
      },
      commands: [{ type: "SEND_MESSAGE", text: enrichment.answer }],
    };
  }

  // Short acknowledgments
  const acknowledgmentKeywords = [
    "ok",
    "gracias",
    "thanks",
    "vale",
    "perfecto",
    "listo",
    "entendido",
  ];
  const isAcknowledgment = acknowledgmentKeywords.some(
    (kw) => normalized === kw || normalized.startsWith(kw + " "),
  );

  if (isAcknowledgment && normalized.length < 15) {
    // First acknowledgment after confirmation
    if (!phase.subPhase || phase.subPhase === "just_confirmed") {
      return {
        type: "update",
        nextPhase: {
          phase: "closing",
          purchaseConfirmed: phase.purchaseConfirmed,
          subPhase: "post_sale_support",
        },
        commands: [
          {
            type: "SEND_MESSAGE",
            text: "¡Perfecto! Si tienes más preguntas, aquí estoy.",
          },
        ],
      };
    }
    // For subsequent acknowledgments, stay quiet
    return { type: "update", nextPhase: phase, commands: [] };
  }

  // Longer message that's not a question
  if (normalized.length > 15) {
    return {
      type: "update",
      nextPhase: phase,
      commands: [
        {
          type: "SEND_MESSAGE",
          text: "Entendido. El agente que se contactará contigo podrá ayudarte con cualquier detalle adicional.",
        },
      ],
    };
  }

  return { type: "update", nextPhase: phase, commands: [] };
}

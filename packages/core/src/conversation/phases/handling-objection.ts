import type {
  ConversationPhase,
  TransitionResult,
  EnrichmentResult,
  ConversationMetadata,
} from "../types.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import * as S from "../../templates/sales.ts";
import { isAffirmative } from "../../validation/affirmation.ts";

type HandlingObjectionPhase = Extract<
  ConversationPhase,
  { phase: "handling_objection" }
>;

const MAX_OBJECTIONS = 2;

// Anchored at the start: "nada que ver, está caro" contains "ver" and is a
// rejection.
const ASKS_TO_SEE =
  /^((s[ií]|ok|claro|dale|bueno|ya)[\s,.!]+)*(mu[eé]strame|quiero\s+ver|a\s+ver|ver|veamos)(?![\p{L}])/u;

export function transitionHandlingObjection(
  phase: HandlingObjectionPhase,
  message: string,
  _metadata: ConversationMetadata,
  enrichment?: EnrichmentResult,
): TransitionResult {
  const lower = message.toLowerCase();

  // An enrichment means the message matched nothing below on the first pass.
  // Every branch here ends the turn or asks for a different enrichment, so the
  // loop never comes back with the same request.
  if (enrichment) {
    if (enrichment.type === "question_answered") {
      return {
        type: "update",
        nextPhase: phase,
        commands: [
          {
            type: "SEND_MESSAGE",
            text:
              enrichment.answer + "\n\n¿Te gustaría ver alguna otra opción?",
          },
        ],
      };
    }

    if (enrichment.type === "question_detected" && enrichment.isQuestion) {
      return {
        type: "need_enrichment",
        enrichment: { type: "should_escalate", message },
      };
    }

    if (enrichment.type === "escalation_needed") {
      if (enrichment.shouldEscalate) {
        return {
          type: "update",
          nextPhase: {
            phase: "escalated",
            reason: "customer_question_during_objection",
          },
          commands: [],
        };
      }

      return {
        type: "need_enrichment",
        enrichment: {
          type: "answer_question",
          message,
          context: {
            segment: phase.segment,
            creditLine: phase.credit,
            phase: "handling_objection",
            availableCategories: [],
          },
        },
      };
    }

    return {
      type: "update",
      nextPhase: phase,
      commands: [
        { type: "SEND_MESSAGE", text: "¿Te gustaría ver alguna otra opción?" },
      ],
    };
  }

  // Too many objections, escalate
  if (phase.objectionCount >= MAX_OBJECTIONS) {
    return {
      type: "update",
      nextPhase: {
        phase: "escalated",
        reason: "multiple_objections",
      },
      commands: [],
    };
  }

  if (isAffirmative(message) || ASKS_TO_SEE.test(lower)) {
    return {
      type: "update",
      nextPhase: {
        phase: "offering_products",
        segment: phase.segment,
        credit: phase.credit,
        name: phase.name,
      },
      commands: [
        {
          type: "SEND_MESSAGE",
          text: "¿Qué tipo de producto te gustaría ver?",
        },
      ],
    };
  }

  // User still rejecting
  if (/\b(no|nada|no\s+quiero)\b/.test(lower)) {
    if (phase.objectionCount === 1 && phase.segment === "gaso") {
      // Offer therma as alternative
      const { message } = selectVariant(
        S.THERMA_ALTERNATIVE,
        "THERMA_ALTERNATIVE",
        {},
      );

      return {
        type: "update",
        nextPhase: {
          ...phase,
          objectionCount: phase.objectionCount + 1,
        },
        commands: message.map((text) => ({
          type: "SEND_MESSAGE" as const,
          text,
        })),
      };
    }

    // Another objection
    const { message } = selectVariant(
      S.KITCHEN_OBJECTION_RESPONSE,
      "KITCHEN_OBJECTION",
      {},
    );

    return {
      type: "update",
      nextPhase: {
        ...phase,
        objectionCount: phase.objectionCount + 1,
      },
      commands: message.map((text) => ({
        type: "SEND_MESSAGE" as const,
        text,
      })),
    };
  }

  // Check if it's a question, need LLM
  return {
    type: "need_enrichment",
    enrichment: { type: "detect_question", message },
  };
}

/**
 * Handling objection phase transition
 *
 * Handles price concerns, kitchen bundle rejections, etc.
 */

import type {
  ConversationPhase,
  TransitionResult,
  EnrichmentResult,
} from "../types.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import * as S from "../../templates/sales.ts";

type HandlingObjectionPhase = Extract<
  ConversationPhase,
  { phase: "handling_objection" }
>;

const MAX_OBJECTIONS = 2;

export function transitionHandlingObjection(
  phase: HandlingObjectionPhase,
  message: string,
  _metadata: unknown,
  enrichment?: EnrichmentResult,
): TransitionResult {
  const lower = message.toLowerCase();

  // Handle LLM question detection/answering first
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

    if (enrichment.type === "escalation_needed" && enrichment.shouldEscalate) {
      return {
        type: "update",
        nextPhase: {
          phase: "escalated",
          reason: "customer_question_during_objection",
        },
        commands: [
          {
            type: "NOTIFY_TEAM",
            channel: "agent",
            message: `Cliente tiene dudas durante manejo de objeción`,
          },
          { type: "ESCALATE", reason: "customer_question_during_objection" },
        ],
      };
    }
  }

  // Too many objections - escalate
  if (phase.objectionCount >= MAX_OBJECTIONS) {
    return {
      type: "update",
      nextPhase: {
        phase: "escalated",
        reason: "multiple_objections",
      },
      commands: [
        {
          type: "NOTIFY_TEAM",
          channel: "agent",
          message: `Cliente rechazó bundle múltiples veces. Requiere atención.`,
        },
        { type: "ESCALATE", reason: "multiple_objections" },
      ],
    };
  }

  // User accepts
  if (
    /\b(s[ií]|ok|claro|dale|bueno|ver|muestrame|quiero\s+ver)\b/.test(lower)
  ) {
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
      const { message: response } = selectVariant(
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
        commands: [{ type: "SEND_MESSAGE", text: response }],
      };
    }

    // Another objection
    const { message: response } = selectVariant(
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
      commands: [{ type: "SEND_MESSAGE", text: response }],
    };
  }

  // Check if it's a question - need LLM
  return {
    type: "need_enrichment",
    enrichment: { type: "detect_question", message },
  };
}

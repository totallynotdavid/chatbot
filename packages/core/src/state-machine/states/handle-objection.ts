import type { StateOutput } from "../types.ts";
import * as T from "../../templates/standard.ts";
import * as S from "../../templates/sales.ts";
import {
  selectVariant,
  selectVariantWithContext,
} from "../../messaging/variation-selector.ts";
import { handleOfferProducts } from "./offer-products.ts";

export function handleObjection(message: string, context: any): StateOutput {
  const objectionCount = context.objectionCount || 0;

  // Check if backend detected a question via LLM
  if (context.llmDetectedQuestion) {
    // If requires human, escalate; otherwise answer and continue
    if (context.llmRequiresHuman) {
      return {
        nextState: "ESCALATED",
        commands: [
          {
            type: "ESCALATE",
            reason: "customer_question_during_objection",
          },
          {
            type: "NOTIFY_TEAM",
            channel: "agent",
            message: `Cliente ${context.phoneNumber} tiene dudas durante objeción`,
          },
        ],
        updatedContext: {},
      };
    }

    // Answer question and continue handling objection
    return {
      nextState: "HANDLE_OBJECTION",
      commands: [
        {
          type: "SEND_MESSAGE",
          content: context.llmGeneratedAnswer || "Déjame explicarte...",
        },
        {
          type: "SEND_MESSAGE",
          content: "¿Te gustaría ver alguna otra opción?",
        },
      ],
      updatedContext: {},
    };
  }

  if (objectionCount >= 2) {
    // Escalate after second objection
    const { message: handoffMsg, updatedContext: variantCtx } =
      selectVariantWithContext(
        T.HANDOFF_TO_HUMAN,
        "HANDOFF_TO_HUMAN",
        context,
        { frustrated: true },
      );
    return {
      nextState: "ESCALATED",
      commands: [
        { type: "SEND_MESSAGE", content: handoffMsg },
        {
          type: "ESCALATE",
          reason: "Multiple objections to mandatory kitchen bundle",
        },
        {
          type: "NOTIFY_TEAM",
          channel: "agent",
          message: `Cliente ${context.phoneNumber} rechazó bundle de cocina múltiples veces. Requiere atención.`,
        },
      ],
      updatedContext: variantCtx,
    };
  }

  const lower = message.toLowerCase();

  // Still rejecting
  if (/\b(no|nada|no quiero)\b/.test(lower)) {
    if (objectionCount === 1) {
      // Offer therma as last resort
      const { message: thermaMsg, updatedContext: variantCtx } = selectVariant(
        S.THERMA_ALTERNATIVE,
        "THERMA_ALTERNATIVE",
        context,
      );
      return {
        nextState: "HANDLE_OBJECTION",
        commands: [{ type: "SEND_MESSAGE", content: thermaMsg }],
        updatedContext: { objectionCount: 2, ...variantCtx },
      };
    }

    const { message: objectionMsg, updatedContext: variantCtx } = selectVariant(
      S.KITCHEN_OBJECTION_RESPONSE,
      "KITCHEN_OBJECTION_RESPONSE",
      context,
    );
    return {
      nextState: "HANDLE_OBJECTION",
      commands: [{ type: "SEND_MESSAGE", content: objectionMsg }],
      updatedContext: { objectionCount: objectionCount + 1, ...variantCtx },
    };
  }

  // Accepted
  if (/\b(s[ií]|ok|claro|dale|bueno)\b/.test(lower)) {
    return handleOfferProducts(message, context);
  }

  const { message: clarifyMsg, updatedContext: variantCtx } = selectVariant(
    T.ASK_CLARIFICATION,
    "ASK_CLARIFICATION",
    context,
  );
  return {
    nextState: "HANDLE_OBJECTION",
    commands: [{ type: "SEND_MESSAGE", content: clarifyMsg }],
    updatedContext: variantCtx,
  };
}

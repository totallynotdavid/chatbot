import type { StateOutput } from "../types.ts";
import * as T from "../../templates/standard.ts";
import { selectVariantWithContext } from "../../messaging/variation-selector.ts";

export function handleWaitingProvider(context: any): StateOutput {
  // If user is still messaging while waiting, they're getting impatient
  const messageCount = (context.waitingMessageCount || 0) + 1;

  // After 3 frustrated attempts, escalate silently
  if (messageCount > 2) {
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
        {
          type: "SEND_MESSAGE",
          content: handoffMsg,
        },
        {
          type: "ESCALATE",
          reason: "provider_check_timeout_multiple_messages",
        },
      ],
      updatedContext: {
        waitingMessageCount: messageCount,
        isFrustrated: true,
        lastBotMessageTime: new Date().toISOString(),
        ...variantCtx,
      },
    };
  }

  // First message - acknowledge with patience variant
  if (messageCount === 1) {
    const { message: checkingMsg, updatedContext: variantCtx } =
      selectVariantWithContext(T.CHECKING_SYSTEM, "CHECKING_SYSTEM", context, {
        needsPatience: true,
      });
    return {
      nextState: "WAITING_PROVIDER",
      commands: [
        {
          type: "SEND_MESSAGE",
          content: checkingMsg,
        },
      ],
      updatedContext: {
        waitingMessageCount: messageCount,
        lastBotMessageTime: new Date().toISOString(),
        ...variantCtx,
      },
    };
  }

  // Second message - empathetic variant recognizing frustration
  const { message: empathyMsg, updatedContext: variantCtx } =
    selectVariantWithContext(T.CHECKING_SYSTEM, "CHECKING_SYSTEM", context, {
      frustrated: true,
    });
  return {
    nextState: "WAITING_PROVIDER",
    commands: [
      {
        type: "SEND_MESSAGE",
        content: empathyMsg,
      },
    ],
    updatedContext: {
      waitingMessageCount: messageCount,
      lastBotMessageTime: new Date().toISOString(),
      ...variantCtx,
    },
  };
}

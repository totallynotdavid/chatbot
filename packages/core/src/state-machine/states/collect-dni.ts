import type { StateOutput } from "../types.ts";
import { extractDNI } from "../../validation/regex.ts";
import * as T from "../../templates/standard.ts";
import {
  selectVariant,
  selectVariantWithContext,
} from "../../messaging/variation-selector.ts";
import {
  detectNeedsPatience,
  isAcknowledgment,
} from "../../messaging/context-analyzer.ts";
import { detectTone } from "../../messaging/tone-detector.ts";

export function handleCollectDNI(message: string, context: any): StateOutput {
  const dni = extractDNI(message);

  // Increment message count in this state
  const messageCountInState = (context.messageCountInState || 0) + 1;

  if (dni) {
    // Detect tone for future interactions
    const userTone = detectTone(message);

    return {
      nextState: "WAITING_PROVIDER",
      commands: [
        { type: "CHECK_FNB", dni },
        {
          type: "TRACK_EVENT",
          eventType: "dni_collected",
          metadata: { dni },
        },
      ],
      updatedContext: {
        dni,
        userTone,
        messageCountInState: 0,
        lastBotMessageTime: new Date().toISOString(),
      },
    };
  }

  const lower = message.toLowerCase();

  // Detect if user needs patience
  const needsPatience = detectNeedsPatience(message);

  // Check if user can't provide DNI right now
  const cantProvideNow =
    /(no\s+(lo\s+)?tengo|no\s+tengo\s+a\s+la\s+mano|voy\s+a\s+busca|d[e\u00e9]jame\s+busca|un\s+momento|espera|buscando|no\s+me\s+acuerdo|no\s+s[e\u00e9]|no\s+lo\s+encuentro)/.test(
      lower,
    );
  const willSendLater =
    /(te\s+(mando|env[i\u00ed]o|escribo)|en\s+un\s+rato|m[a\u00e1]s\s+tarde|luego|despu[e\u00e9]s|ahora\s+no|ahorita\s+no)/.test(
      lower,
    );

  // If they say they'll send it later, wait silently
  if (willSendLater) {
    return {
      nextState: "COLLECT_DNI",
      commands: [],
      updatedContext: { messageCountInState },
    };
  }

  // If they can't provide it now, respond once with waiting message
  if (cantProvideNow || needsPatience) {
    if (!context.askedToWait) {
      const { message: waitMsg, updatedContext: variantCtx } =
        selectVariantWithContext(T.DNI_WAITING, "DNI_WAITING", context, {
          needsPatience: true,
        });
      return {
        nextState: "COLLECT_DNI",
        commands: [{ type: "SEND_MESSAGE", content: waitMsg }],
        updatedContext: {
          askedToWait: true,
          messageCountInState,
          lastBotMessageTime: new Date().toISOString(),
          ...variantCtx,
        },
      };
    }
    // Already asked them to wait, stay silent
    return {
      nextState: "COLLECT_DNI",
      commands: [],
      updatedContext: { messageCountInState },
    };
  }

  // Check for pure acknowledgment messages
  const isAck = isAcknowledgment(message);
  if (isAck) {
    return {
      nextState: "COLLECT_DNI",
      commands: [],
      updatedContext: { messageCountInState },
    };
  }

  // Check for progress updates
  const isProgressUpdate = /(ya\s+casi|casi|esperame|un\s+segundo)/.test(lower);
  if (isProgressUpdate) {
    return {
      nextState: "COLLECT_DNI",
      commands: [],
      updatedContext: { messageCountInState },
    };
  }

  // Very short responses - stay silent
  const veryShort = message.trim().length <= 3;
  if (veryShort) {
    return {
      nextState: "COLLECT_DNI",
      commands: [],
      updatedContext: { messageCountInState },
    };
  }

  // Invalid DNI format
  const { message: invalidMsg, updatedContext: variantCtx } = selectVariant(
    T.INVALID_DNI,
    "INVALID_DNI",
    context,
  );
  return {
    nextState: "COLLECT_DNI",
    commands: [{ type: "SEND_MESSAGE", content: invalidMsg }],
    updatedContext: variantCtx,
  };
}

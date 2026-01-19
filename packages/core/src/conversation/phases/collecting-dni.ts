import type {
  ConversationMetadata,
  TransitionResult,
  EnrichmentResult,
} from "../types.ts";
import {
  selectVariant,
  selectVariantWithContext,
} from "../../messaging/variation-selector.ts";
import { extractDNI } from "../../validation/regex.ts";
import * as T from "../../templates/standard.ts";

export function transitionCollectingDni(
  message: string,
  metadata: ConversationMetadata,
  enrichment?: EnrichmentResult,
): TransitionResult {
  if (enrichment?.type === "recovery_response") {
    return {
      type: "update",
      nextPhase: { phase: "collecting_dni" },
      commands: [{ type: "SEND_MESSAGE", text: enrichment.text }],
    };
  }

  const dni = extractDNI(message);
  const lower = message.toLowerCase();

  if (dni) {
    const triedDnis = metadata.triedDnis || [];
    if (triedDnis.includes(dni)) {
      // DNI already attempted, ask for a different one
      const { message: messages } = selectVariant(
        T.DNI_ALREADY_TRIED,
        "DNI_ALREADY_TRIED",
        {},
      );

      return {
        type: "update",
        nextPhase: { phase: "collecting_dni" },
        commands: messages.map((text) => ({
          type: "SEND_MESSAGE" as const,
          text,
        })),
      };
    }

    // Valid DNI not tried before, request provider check
    return {
      type: "need_enrichment",
      enrichment: { type: "check_eligibility", dni },
      pendingPhase: { phase: "checking_eligibility", dni },
    };
  }

  const hasOnlyDigits = /^\d+$/.test(message.trim());
  if (hasOnlyDigits) {
    const digitCount = message.trim().length;
    if (digitCount === 7) {
      return {
        type: "update",
        nextPhase: { phase: "collecting_dni" },
        commands: [
          {
            type: "SEND_MESSAGE",
            text: "Me parece que falta un dígito en tu DNI. ¿Podrías verificarlo? 😅",
          },
        ],
      };
    }
    if (digitCount === 9 || digitCount > 9) {
      return {
        type: "update",
        nextPhase: { phase: "collecting_dni" },
        commands: [
          {
            type: "SEND_MESSAGE",
            text: "El DNI debe tener exactamente 8 dígitos. Me parece que hay dígitos de más. 😅",
          },
        ],
      };
    }
  }

  // Mix of letters and numbers (invalid)
  if (/^[a-zA-Z]+\d+|^\d+[a-zA-Z]+/.test(message.trim())) {
    return {
      type: "update",
      nextPhase: { phase: "collecting_dni" },
      commands: [
        {
          type: "SEND_MESSAGE",
          text: "El DNI solo debe contener números (8 dígitos). Inténtalo de nuevo por favor. 🙏",
        },
      ],
    };
  }

  // User says they'll send later
  const willSendLater =
    /(te\s+(mando|env[i\u00ed]o|escribo)|en\s+un\s+rato|m[a\u00e1]s\s+tarde|luego|despu[e\u00e9]s|ahora\s+no|ahorita\s+no)/.test(
      lower,
    );

  if (willSendLater) {
    // Stay silent, wait for DNI
    return {
      type: "update",
      nextPhase: { phase: "collecting_dni" },
      commands: [],
    };
  }

  // User can't provide DNI right now
  const cantProvideNow =
    /(no\s+(lo\s+)?tengo|no\s+tengo\s+a\s+la\s+mano|voy\s+a\s+busca|d[e\u00e9]jame\s+busca|un\s+momento|espera|buscando|no\s+me\s+acuerdo|no\s+s[e\u00e9]|no\s+lo\s+encuentro)/.test(
      lower,
    );

  if (cantProvideNow) {
    const { message: messages } = selectVariantWithContext(
      T.DNI_WAITING,
      "DNI_WAITING",
      {},
      { needsPatience: true },
    );

    return {
      type: "update",
      nextPhase: { phase: "collecting_dni" },
      commands: messages.map((text) => ({
        type: "SEND_MESSAGE" as const,
        text,
      })),
    };
  }

  // For pure acknowledgment messages, stay silent
  const isAck = /^(ok|ya|listo|ahi|ahí|va|bien|dale|okey|oki|vale)$/i.test(
    message.trim(),
  );
  if (isAck) {
    return {
      type: "update",
      nextPhase: { phase: "collecting_dni" },
      commands: [],
    };
  }

  // For progress update, stay silent
  const isProgressUpdate = /(ya\s+casi|casi|esperame|un\s+segundo)/.test(lower);
  if (isProgressUpdate) {
    return {
      type: "update",
      nextPhase: { phase: "collecting_dni" },
      commands: [],
    };
  }

  // For very short responses, stay silent
  if (message.trim().length <= 3) {
    return {
      type: "update",
      nextPhase: { phase: "collecting_dni" },
      commands: [],
    };
  }

  // No DNI found and no special intent, re-ask with LLM help
  return {
    type: "need_enrichment",
    enrichment: {
      type: "recover_unclear_response",
      message,
      context: {
        phase: "collecting_dni",
        lastQuestion:
          "¿Me podrías facilitar tu número de DNI para verificar tu crédito?",
        expectedOptions: ["8 dígitos numéricos"],
      },
    },
    pendingPhase: { phase: "collecting_dni" },
  };
}

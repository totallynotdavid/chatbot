import type { ConversationMetadata, TransitionResult } from "../types.ts";
import {
  selectVariant,
  selectVariantWithContext,
} from "../../messaging/variation-selector.ts";
import { extractDNI } from "../../validation/regex.ts";
import * as T from "../../templates/standard.ts";

export function transitionCollectingDni(
  message: string,
  _metadata: ConversationMetadata,
): TransitionResult {
  const dni = extractDNI(message);
  const lower = message.toLowerCase();

  if (dni) {
    // Valid DNI, request provider check
    return {
      type: "need_enrichment",
      enrichment: { type: "check_eligibility", dni },
      pendingPhase: { phase: "checking_eligibility", dni },
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
    const { message: response } = selectVariantWithContext(
      T.DNI_WAITING,
      "DNI_WAITING",
      {},
      { needsPatience: true },
    );
    const messages = Array.isArray(response) ? response : [response];

    return {
      type: "update",
      nextPhase: { phase: "collecting_dni" },
      commands: messages.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
    };
  }

  // For pure acknowledgment messages, stay silent
  const isAck = /^(ok|ya|listo|ahi|ahí|va|bien|dale|okey|oki)$/i.test(
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

  // Invalid DNI format
  const { message: response } = selectVariant(T.INVALID_DNI, "INVALID_DNI", {});
  const messages = Array.isArray(response) ? response : [response];

  return {
    type: "update",
    nextPhase: { phase: "collecting_dni" },
    commands: messages.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
  };
}

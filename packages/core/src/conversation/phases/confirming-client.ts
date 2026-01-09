import type { ConversationMetadata, TransitionResult } from "../types.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import { extractDNI } from "../../validation/regex.ts";
import * as T from "../../templates/standard.ts";

export function transitionConfirmingClient(
  message: string,
  metadata: ConversationMetadata,
): TransitionResult {
  const lower = message.toLowerCase().trim();

  // Check if user volunteered DNI early
  const earlyDNI = extractDNI(message);

  // NEGATIVE patterns
  if (
    /no\s+(tengo|soy)/.test(lower) ||
    /^no(\s|,|!|$)/.test(lower) ||
    /\b(nada|negativo)(\s|,|!|$)/.test(lower)
  ) {
    const { message: response } = selectVariant(
      T.CONFIRM_CLIENT_NO,
      "CONFIRM_CLIENT_NO",
      {},
    );

    return {
      type: "advance",
      nextPhase: { phase: "closing", purchaseConfirmed: false },
      response,
      track: {
        eventType: "not_calidda_client",
        metadata: { response: message },
      },
    };
  }

  // POSITIVE patterns
  if (
    /\bs[ií]+(\s|,|!|\?|$)/.test(lower) ||
    /\b(claro|ok|vale|dale|afirmativo|correcto|sep|bueno)(\s|,|!|\?|$)/.test(
      lower,
    ) ||
    /(soy|tengo)\s+(cliente|c[ií]lidda|gas)/.test(lower)
  ) {
    // If we have previous session data
    if (metadata.dni && metadata.segment && metadata.credit !== undefined) {
      if (metadata.segment === "fnb") {
        return {
          type: "advance",
          nextPhase: {
            phase: "offering_products",
            segment: "fnb",
            credit: metadata.credit,
            name: metadata.name || "",
          },
          response: metadata.name
            ? `¡Excelente ${metadata.name}! Sigamos viendo opciones para ti.`
            : `¡Excelente! Sigamos viendo opciones para ti.`,
        };
      }

      // GASO needs age confirmation
      return {
        type: "advance",
        nextPhase: {
          phase: "collecting_age",
          dni: metadata.dni,
          name: metadata.name || "",
        },
        response: metadata.name
          ? `¡Excelente ${metadata.name}! Sigamos viendo opciones para ti.`
          : `¡Excelente! Sigamos viendo opciones para ti.`,
      };
    }

    // User provided DNI in same message
    if (earlyDNI) {
      return {
        type: "need_enrichment",
        enrichment: { type: "check_eligibility", dni: earlyDNI },
        pendingPhase: { phase: "checking_eligibility", dni: earlyDNI },
      };
    }

    // Normal flow, ask for DNI
    const { message: response } = selectVariant(
      T.CONFIRM_CLIENT_YES,
      "CONFIRM_CLIENT_YES",
      {},
    );

    return {
      type: "advance",
      nextPhase: { phase: "collecting_dni" },
      response,
      track: {
        eventType: "confirmed_calidda_client",
        metadata: { response: message },
      },
    };
  }

  return {
    type: "stay",
    response:
      "Disculpa, no entendí. ¿Eres titular del servicio de gas natural de Calidda? (Responde Sí o No)",
  };
}

import type { StateOutput } from "../types.ts";
import { extractDNI } from "../../validation/regex.ts";
import { formatFirstName } from "../../validation/format-name.ts";
import * as T from "../../templates/standard.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";

export function handleConfirmClient(
  message: string,
  context: any,
): StateOutput {
  const lower = message.toLowerCase().trim();

  // Check if user volunteered DNI early (e.g., "Sí, mi DNI es 72345678")
  const earlyDNI = extractDNI(message);

  // NEGATIVE CHECK FIRST - specific "no" + verb patterns
  if (
    /no\s+(tengo|soy)/.test(lower) || // "no tengo" or "no soy"
    /^no(\s|,|!|$)/.test(lower) || // just "no"
    /\b(nada|negativo)(\s|,|!|$)/.test(lower) // "nada" or "negativo"
  ) {
    const { message: noMsg, updatedContext: variantCtx } = selectVariant(
      T.CONFIRM_CLIENT_NO,
      "CONFIRM_CLIENT_NO",
      context,
    );
    return {
      nextState: "CLOSING",
      commands: [
        { type: "SEND_MESSAGE", content: noMsg },
        {
          type: "TRACK_EVENT",
          eventType: "not_calidda_client",
          metadata: { response: message },
        },
      ],
      updatedContext: { isCaliddaClient: false, ...variantCtx },
    };
  }

  // POSITIVE CHECK - contains clear affirmations
  if (
    /\bs[ií]+(\s|,|!|\?|$)/.test(lower) || // "sí", "si", "siii", "síííí"
    /\b(claro|ok|vale|dale|afirmativo|correcto|sep|bueno)(\s|,|!|\?|$)/.test(
      lower,
    ) || // common affirmations
    /(soy|tengo)\s+(cliente|c[ií]lidda|gas)/.test(lower) // "soy cliente"
  ) {
    // SMART RESUME: If we already have DNI and credit info from previous session
    if (context.dni && context.segment && context.creditLine !== undefined) {
      const firstName = context.clientName
        ? formatFirstName(context.clientName)
        : "";
      const resumeMsg = firstName
        ? `¡Excelente ${firstName}! Sigamos viendo opciones para ti.`
        : `¡Excelente! Sigamos viendo opciones para ti.`;

      // If it's FNB, skip straight to offering products
      if (context.segment === "fnb") {
        return {
          nextState: "OFFER_PRODUCTS",
          commands: [
            { type: "SEND_MESSAGE", content: resumeMsg },
            {
              type: "SEND_MESSAGE",
              content: `Anteriormente buscabas ${context.lastInterestCategory || "productos"}. ¿Quieres ver opciones o prefieres otra cosa?`,
            },
          ],
          updatedContext: { isCaliddaClient: true },
        };
      }

      // If it's Gaso, still need age
      return {
        nextState: "COLLECT_AGE",
        commands: [{ type: "SEND_MESSAGE", content: resumeMsg }],
        updatedContext: { isCaliddaClient: true },
      };
    }

    // If they already provided DNI in THIS message, skip straight to provider check
    if (earlyDNI) {
      return {
        nextState: "WAITING_PROVIDER",
        commands: [
          { type: "CHECK_FNB", dni: earlyDNI },
          {
            type: "TRACK_EVENT",
            eventType: "confirmed_calidda_client",
            metadata: { response: message },
          },
        ],
        updatedContext: { isCaliddaClient: true, dni: earlyDNI },
      };
    }

    const { message: yesMsg, updatedContext: variantCtx } = selectVariant(
      T.CONFIRM_CLIENT_YES,
      "CONFIRM_CLIENT_YES",
      context,
    );
    return {
      nextState: "COLLECT_DNI",
      commands: [
        { type: "SEND_MESSAGE", content: yesMsg },
        {
          type: "TRACK_EVENT",
          eventType: "confirmed_calidda_client",
          metadata: { response: message },
        },
      ],
      updatedContext: { isCaliddaClient: true, ...variantCtx },
    };
  }

  // Unclear - user didn't clearly say yes or no
  return {
    nextState: "CONFIRM_CLIENT",
    commands: [
      {
        type: "SEND_MESSAGE",
        content: `Disculpa, no entendí. ¿Eres titular del servicio de gas natural de Calidda? (Responde Sí o No)`,
      },
    ],
    updatedContext: {},
  };
}

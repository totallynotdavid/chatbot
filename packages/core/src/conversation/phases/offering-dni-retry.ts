import type {
  ConversationMetadata,
  TransitionResult,
  EnrichmentResult,
} from "../types.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import { extractDNI } from "../../validation/regex.ts";
import { transitionCollectingDni } from "./collecting-dni.ts";
import { isAffirmative, isNegative } from "../../validation/affirmation.ts";
import * as T from "../../templates/standard.ts";

type OfferingDniRetryPhase = Extract<
  import("../types.ts").ConversationPhase,
  { phase: "offering_dni_retry" }
>;

export function transitionOfferingDniRetry(
  phase: OfferingDniRetryPhase,
  message: string,
  metadata: ConversationMetadata,
  enrichment?: EnrichmentResult,
): TransitionResult {
  // Use LLM recovery if available
  if (enrichment?.type === "recovery_response") {
    return {
      type: "update",
      nextPhase: phase,
      commands: [{ type: "SEND_MESSAGE", text: enrichment.text }],
    };
  }

  // Every DNI tried so far has failed, or this phase would not be reached.
  const attemptCount = metadata.triedDnis?.length ?? 0;

  if (extractDNI(message)) {
    return transitionCollectingDni(message, metadata);
  }

  // User explicitly declines retry
  if (isNegative(message)) {
    const { message: messages } = selectVariant(
      [
        ["Entiendo. Si en el futuro cambias de opinión, aquí estaré 😊"],
        [
          "Está bien. Gracias por tu tiempo. Cualquier cosa, nos vuelves a escribir.",
        ],
        [
          "Sin problema. Si más adelante quieres revisar otra opción, no dudes en contactarnos.",
        ],
      ],
      "DNI_RETRY_DECLINED",
      {},
    );

    return {
      type: "update",
      nextPhase: { phase: "closing", purchaseConfirmed: false },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "dni_retry_declined",
          metadata: { attemptCount },
        },
        ...messages.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
      ],
    };
  }

  // User accepts (positive response)
  if (isAffirmative(message)) {
    const { message: messages } = selectVariant(
      T.CONFIRM_CLIENT_YES,
      "ASK_DNI_RETRY",
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

  // For acknowledgment or unclear responses, re-prompt with LLM
  return {
    type: "need_enrichment",
    enrichment: {
      type: "recover_unclear_response",
      message,
      context: {
        phase: "offering_dni_retry",
        lastQuestion: "¿Te gustaría intentar con otro número de DNI?",
        expectedOptions: ["Sí", "No"],
      },
    },
    pendingPhase: phase,
  };
}

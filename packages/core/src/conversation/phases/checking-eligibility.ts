import type {
  ConversationPhase,
  TransitionResult,
  EnrichmentResult,
  ConversationMetadata,
} from "../types.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import { checkFNBEligibility } from "../../eligibility/fnb-logic.ts";
import * as T from "../../templates/standard.ts";
import * as S from "../../templates/sales.ts";
import { formatFirstName } from "../../validation/format-name.ts";

type CheckingEligibilityPhase = Extract<
  ConversationPhase,
  { phase: "checking_eligibility" }
>;

export function transitionCheckingEligibility(
  phase: CheckingEligibilityPhase,
  _message: string,
  metadata: ConversationMetadata,
  enrichment?: EnrichmentResult,
): TransitionResult {
  // If no enrichment, request eligibility check
  if (!enrichment) {
    return {
      type: "need_enrichment",
      enrichment: { type: "check_eligibility", dni: phase.dni },
    };
  }

  if (enrichment.type === "eligibility_result") {
    // Case 1: System outage
    if (enrichment.status === "system_outage") {
      return {
        type: "update",
        nextPhase: {
          phase: "waiting_for_recovery",
          dni: phase.dni,
          timestamp: Date.now(),
        },
        commands: [
          {
            type: "NOTIFY_TEAM",
            channel: "dev",
            message: `URGENTE: Caída total de proveedores de elegibilidad. Cliente ${phase.dni} en espera. Revisar dashboard.`,
          },
          {
            type: "NOTIFY_TEAM",
            channel: "agent",
            message: `Sistema de verificación temporalmente no disponible. El cliente con ${phase.dni} fue puesto en espera.`,
          },
        ],
      };
    }

    // Case 2: Needs human (standard escalation, e.g. edge cases)
    if (enrichment.status === "needs_human") {
      const { message } = selectVariant(
        [
          ["Perfecto, déjame verificar tu información. Dame un momento. 🙏"],
          ["Genial, dame un momentito mientras reviso tu línea de crédito. 😊"],
          ["Déjame consultar tu información. Un momento, por favor."],
        ],
        "CHECKING_HOLD",
        {},
      );

      return {
        type: "update",
        nextPhase: {
          phase: "escalated",
          reason: enrichment.handoffReason || "eligibility_check_failed",
        },
        commands: [
          ...message.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
          {
            type: "NOTIFY_TEAM",
            channel: "agent",
            message: `Cliente en espera. Verificación de elegibilidad: DNI ${phase.dni}. Requiere atención manual.`,
          },
          {
            type: "ESCALATE",
            reason: enrichment.handoffReason || "eligibility_check_failed",
          },
        ],
      };
    }

    // Case 2: Customer is eligible
    if (enrichment.status === "eligible" && enrichment.segment) {
      const segment = enrichment.segment;
      const credit = enrichment.credit || 0;
      const name = formatFirstName(enrichment.name || "");
      const affordableCategories = enrichment.affordableCategories || [];
      const categoryDisplayNames = enrichment.categoryDisplayNames || [];
      const groupDisplayNames = enrichment.groupDisplayNames || [];

      // For FNB, check business rules
      if (segment === "fnb") {
        if (!checkFNBEligibility(credit)) {
          // Credit too low for FNB
          const { message } = selectVariant(T.NOT_ELIGIBLE, "NOT_ELIGIBLE", {});

          return {
            type: "update",
            nextPhase: { phase: "closing", purchaseConfirmed: false },
            commands: [
              {
                type: "TRACK_EVENT",
                event: "eligibility_failed",
                metadata: { segment: "fnb", credit, reason: "credit_too_low" },
              },
              ...message.map((text) => ({
                type: "SEND_MESSAGE" as const,
                text,
              })),
            ],
          };
        }

        // FNB approved, show message with affordable product groups
        const variants = S.FNB_APPROVED(name, credit, groupDisplayNames);
        const { message } = selectVariant(variants, "FNB_APPROVED", {});

        return {
          type: "update",
          nextPhase: {
            phase: "offering_products",
            segment: "fnb",
            credit,
            name,
            availableCategories: affordableCategories,
            affordableBundles: enrichment.affordableBundles,
            categoryDisplayNames,
          },
          commands: [
            {
              type: "TRACK_EVENT",
              event: "eligibility_passed",
              metadata: { segment: "fnb", credit },
            },
            ...message.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
          ],
        };
      }

      // For GASO, always requires age verification
      if (segment === "gaso") {
        const variants = T.ASK_AGE(name);
        const { message } = selectVariant(variants, "ASK_AGE", {});

        return {
          type: "update",
          nextPhase: {
            phase: "collecting_age",
            dni: phase.dni,
            name,
            credit,
            affordableCategories,
            affordableBundles: enrichment.affordableBundles,
            categoryDisplayNames,
          },
          commands: message.map((text) => ({
            type: "SEND_MESSAGE" as const,
            text,
          })),
        };
      }
    }

    // Case 3: Customer not eligible
    if (enrichment.status === "not_eligible") {
      const attemptCount = (metadata.triedDnis?.length || 0) + 1;

      if (attemptCount < 3) {
        const { message } = selectVariant(
          T.OFFER_DNI_RETRY,
          "OFFER_DNI_RETRY",
          {},
        );

        return {
          type: "update",
          nextPhase: { phase: "offering_dni_retry" },
          commands: [
            {
              type: "TRACK_EVENT",
              event: "eligibility_failed",
              metadata: {
                segment: "none",
                reason: "not_eligible",
                attemptCount,
              },
            },
            ...message.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
          ],
        };
      }

      // Max attempts reached, close conversation
      const { message } = selectVariant(
        T.MAX_ATTEMPTS_REACHED,
        "MAX_ATTEMPTS_REACHED",
        {},
      );

      return {
        type: "update",
        nextPhase: { phase: "closing", purchaseConfirmed: false },
        commands: [
          {
            type: "TRACK_EVENT",
            event: "eligibility_failed",
            metadata: {
              segment: "none",
              reason: "not_eligible_max_attempts",
              attemptCount,
            },
          },
          ...message.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
        ],
      };
    }
  }

  // For unknown cases, stay in phase
  return {
    type: "update",
    nextPhase: phase,
    commands: [],
  };
}

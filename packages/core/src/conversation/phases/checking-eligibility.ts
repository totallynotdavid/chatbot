import type {
  ConversationPhase,
  TransitionResult,
  EnrichmentResult,
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
    // Case 1: needs human intervention (both providers down)
    if (enrichment.status === "needs_human") {
      const { message } = selectVariant(
        [
          "Perfecto, déjame verificar tu información. Te respondo en un momento.",
          "Genial, dame un momentito mientras reviso tu línea de crédito.",
          "Déjame consultar tu información. Ya te confirmo.",
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
          { type: "SEND_MESSAGE", text: message },
          {
            type: "NOTIFY_TEAM",
            channel: "agent",
            message: `🔴 Cliente esperando. Verificación de elegibilidad: DNI ${phase.dni}. ${enrichment.handoffReason === "both_providers_down" ? "Ambos proveedores caídos." : "Error en verificación."}`,
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

      // For FNB, check business rules
      if (segment === "fnb") {
        if (!checkFNBEligibility(credit)) {
          // Credit too low for FNB
          const { message: response } = selectVariant(
            T.NOT_ELIGIBLE,
            "NOT_ELIGIBLE",
            {},
          );

          return {
            type: "update",
            nextPhase: { phase: "closing", purchaseConfirmed: false },
            commands: [
              {
                type: "TRACK_EVENT",
                event: "eligibility_failed",
                metadata: { segment: "fnb", credit, reason: "credit_too_low" },
              },
              { type: "SEND_MESSAGE", text: response },
            ],
          };
        }

        // FNB approved
        const variants = S.FNB_APPROVED(name, credit);
        const { message: response } = selectVariant(
          variants,
          "FNB_APPROVED",
          {},
        );

        return {
          type: "update",
          nextPhase: {
            phase: "offering_products",
            segment: "fnb",
            credit,
            name,
          },
          commands: [
            {
              type: "TRACK_EVENT",
              event: "eligibility_passed",
              metadata: { segment: "fnb", credit },
            },
            { type: "SEND_MESSAGE", text: response },
          ],
        };
      }

      // For GASO, always requires age verification
      if (segment === "gaso") {
        const variants = T.ASK_AGE(name);
        const { message: response } = selectVariant(variants, "ASK_AGE", {});

        return {
          type: "update",
          nextPhase: {
            phase: "collecting_age",
            dni: phase.dni,
            name,
          },
          commands: [{ type: "SEND_MESSAGE", text: response }],
        };
      }
    }

    // Case 3: Customer not eligible
    if (enrichment.status === "not_eligible") {
      const { message: response } = selectVariant(
        T.NOT_ELIGIBLE,
        "NOT_ELIGIBLE",
        {},
      );

      return {
        type: "update",
        nextPhase: { phase: "closing", purchaseConfirmed: false },
        commands: [
          {
            type: "TRACK_EVENT",
            event: "eligibility_failed",
            metadata: { segment: "none", reason: "not_eligible" },
          },
          { type: "SEND_MESSAGE", text: response },
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

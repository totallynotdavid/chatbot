import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";
import { checkEligibilityWithFallback } from "../../../domains/eligibility/orchestrator.ts";
import { createLogger } from "../../../lib/logger.ts";
import { mapEligibilityToEnrichment } from "../../../domains/eligibility/mapper.ts";

const logger = createLogger("enrichment");

/**
 * Checks customer credit eligibility via provider health services.
 *
 * Classifies the customer as FNB or GASO based on NSE presence, derives
 * affordable product categories from credit limits, and handles provider failures.
 *
 * Triggered during onboarding when the state machine requests DNI verification.
 */
export class CheckEligibilityHandler
  implements
    EnrichmentHandler<
      Extract<EnrichmentRequest, { type: "check_eligibility" }>,
      Extract<EnrichmentResult, { type: "eligibility_result" }>
    >
{
  readonly type = "check_eligibility" as const;

  async execute(
    request: Extract<EnrichmentRequest, { type: "check_eligibility" }>,
    context: EnrichmentContext,
  ): Promise<Extract<EnrichmentResult, { type: "eligibility_result" }>> {
    try {
      const result = await checkEligibilityWithFallback(
        request.dni,
        context.phoneNumber,
      );

      if (result.needsHuman && result.handoffReason === "both_providers_down") {
        logger.warn(
          { dni: request.dni, reason: result.handoffReason },
          "Returning system_outage status",
        );
      } else if (result.eligible) {
        logger.info(
          {
            dni: request.dni,
            phoneNumber: context.phoneNumber,
            segment: result.nse !== undefined ? "gaso" : "fnb",
            credit: result.credit,
            name: result.name,
          },
          "Customer eligible",
        );
      }

      return mapEligibilityToEnrichment(result);
    } catch (error) {
      logger.error(
        {
          error,
          dni: request.dni,
          phoneNumber: context.phoneNumber,
          enrichmentType: "check_eligibility",
        },
        "Eligibility check failed",
      );

      return {
        type: "eligibility_result",
        status: "needs_human",
        handoffReason: "eligibility_check_error",
      };
    }
  }
}

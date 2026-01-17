import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";
import { checkEligibilityWithFallback } from "../../../domains/eligibility/orchestrator.ts";
import { BundleService } from "../../../domains/catalog/index.ts";
import { getCategoryDisplayNames } from "../../../adapters/catalog/display.ts";
import { createLogger } from "../../../lib/logger.ts";

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

      if (result.needsHuman) {
        return {
          type: "eligibility_result",
          status: "needs_human",
          handoffReason: result.handoffReason,
        };
      }

      if (result.eligible) {
        const segment = result.nse !== undefined ? "gaso" : "fnb";
        const credit = result.credit || 0;

        const affordableCategories = BundleService.getAffordableCategories(
          segment as "fnb" | "gaso",
          credit,
        );

        const categoryDisplayNames =
          getCategoryDisplayNames(affordableCategories);

        logger.info(
          {
            dni: request.dni,
            phoneNumber: context.phoneNumber,
            segment,
            credit,
            name: result.name,
          },
          "Customer eligible",
        );

        const affordableBundles = BundleService.getAvailable({
          segment: segment as "fnb" | "gaso",
          maxPrice: credit,
        });

        return {
          type: "eligibility_result",
          status: "eligible",
          segment: segment as "fnb" | "gaso",
          credit,
          name: result.name,
          nse: result.nse,
          requiresAge: segment === "gaso",
          affordableCategories,
          categoryDisplayNames,
          affordableBundles,
        };
      }

      return {
        type: "eligibility_result",
        status: "not_eligible",
      };
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

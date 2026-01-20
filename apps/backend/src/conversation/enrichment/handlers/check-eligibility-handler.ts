import type { EnrichmentHandler, EnrichmentContext } from "../handler-interface.ts";
import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import { CheckEligibilityHandler } from "../../../domains/eligibility/handlers/check-eligibility-handler.ts";
import { isOk } from "../../../shared/result/index.ts";
import { createLogger } from "../../../lib/logger.ts";

const logger = createLogger("eligibility-enrichment");

/**
 * Enrichment handler that uses the new event-driven architecture
 */
export class CheckEligibilityEnrichmentHandler
  implements
  EnrichmentHandler<
    Extract<EnrichmentRequest, { type: "check_eligibility" }>,
    Extract<EnrichmentResult, { type: "eligibility_result" }>
  > {
  readonly type = "check_eligibility" as const;

  async execute(
    request: Extract<EnrichmentRequest, { type: "check_eligibility" }>,
    context: EnrichmentContext,
  ): Promise<Extract<EnrichmentResult, { type: "eligibility_result" }>> {
    const handler = new CheckEligibilityHandler();

    try {
      const result = await handler.execute(request.dni, context.phoneNumber);

      if (isOk(result)) {
        return result.value as Extract<
          EnrichmentResult,
          { type: "eligibility_result" }
        >;
      }

      // System outage - handler already emitted events and returned proper result
      // This shouldn't happen as handler returns Ok with system_outage status
      logger.error({ dni: request.dni }, "Unexpected error result from handler");

      return {
        type: "eligibility_result",
        status: "needs_human",
        handoffReason: "eligibility_check_error",
      };
    } catch (error) {
      logger.error(
        {
          error,
          dni: request.dni,
          phoneNumber: context.phoneNumber,
        },
        "Eligibility check failed with exception",
      );

      return {
        type: "eligibility_result",
        status: "needs_human",
        handoffReason: "eligibility_check_error",
      };
    }
  }
}

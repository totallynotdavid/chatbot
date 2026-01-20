import type { Result } from "../../../shared/result/index.ts";
import { isErr } from "../../../shared/result/index.ts";
import { eventBus } from "../../../shared/events/index.ts";
import { FNBProvider } from "../providers/fnb-provider.ts";
import { PowerBIProvider } from "../providers/powerbi-provider.ts";
import { evaluateResults } from "../strategy/eligibility-strategy.ts";
import { SystemOutageDetected } from "../events/system-outage-detected.ts";
import { ProviderDegraded } from "../events/provider-degraded.ts";
import type { EnrichmentResult } from "@totem/core";
import { mapEligibilityToEnrichment } from "../mapper.ts";
import { createLogger } from "../../../lib/logger.ts";

const logger = createLogger("check-eligibility");

export class CheckEligibilityHandler {
  constructor(
    private fnbProvider = new FNBProvider(),
    private powerbiProvider = new PowerBIProvider(),
  ) {}

  async execute(
    dni: string,
    phoneNumber?: string,
  ): Promise<Result<EnrichmentResult>> {
    // 1. Check both providers in parallel
    const [fnbResult, powerbiResult] = await Promise.all([
      this.fnbProvider.checkEligibility(dni, phoneNumber),
      this.powerbiProvider.checkEligibility(dni, phoneNumber),
    ]);

    // 2. Evaluate results
    const evaluation = evaluateResults({
      fnb: fnbResult,
      powerbi: powerbiResult,
    });

    // 3. Handle evaluation result
    if (isErr(evaluation)) {
      // If system outage, emit event
      await eventBus.emit(
        SystemOutageDetected({
          dni,
          errors: [
            evaluation.error.fnbError.message,
            evaluation.error.powerbiError.message,
          ],
          timestamp: Date.now(),
        }),
      );

      logger.error(
        {
          dni,
          errors: [evaluation.error.fnbError, evaluation.error.powerbiError],
        },
        "System outage detected",
      );

      return {
        ok: true,
        value: {
          type: "eligibility_result",
          status: "system_outage",
          handoffReason: "both_providers_down",
        },
      };
    }

    // 4. Success with potential warnings
    if (evaluation.value.warnings?.length) {
      const warning = evaluation.value.warnings[0]!;
      await eventBus.emit(
        ProviderDegraded({
          failedProvider: warning.failedProvider,
          workingProvider: warning.workingProvider,
          dni,
          errors: warning.errors,
        }),
      );

      logger.warn(
        {
          dni,
          failedProvider: warning.failedProvider,
          workingProvider: warning.workingProvider,
        },
        "Provider degraded",
      );
    }

    // 5. Log success
    if (evaluation.value.result.eligible) {
      logger.info(
        {
          dni,
          phoneNumber,
          source: evaluation.value.source,
          credit: evaluation.value.result.credit,
          name: evaluation.value.result.name,
        },
        "Customer eligible",
      );
    }

    // 6. Map to enrichment result
    const enrichmentResult = mapEligibilityToEnrichment({
      ...evaluation.value.result,
      needsHuman: false,
    });

    return { ok: true, value: enrichmentResult } as Result<EnrichmentResult>;
  }
}

import type { Result } from "../../../shared/result/index.ts";
import { isErr } from "../../../shared/result/index.ts";
import { asyncEmitter } from "../../../bootstrap/event-bus-setup.ts";
import type { FNBProvider } from "../providers/fnb-provider.ts";
import type { PowerBIProvider } from "../providers/powerbi-provider.ts";
import { evaluateResults } from "../strategy/eligibility-strategy.ts";
import { createEvent } from "../../../shared/events/index.ts";
import type { EnrichmentResult } from "@totem/core";
import type { ConversationRef } from "@totem/types";
import { mapEligibilityToEnrichment } from "../mapper.ts";
import { createLogger } from "../../../lib/logger.ts";

const logger = createLogger("check-eligibility");

export class CheckEligibilityHandler {
  constructor(
    private fnbProvider: FNBProvider,
    private powerbiProvider: PowerBIProvider,
  ) {}

  async execute(
    dni: string,
    ref?: ConversationRef,
  ): Promise<Result<EnrichmentResult>> {
    const eventContext = ref
      ? { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId }
      : undefined;

    // 1. Check both providers in parallel
    const [fnbResult, powerbiResult] = await Promise.all([
      this.fnbProvider.checkEligibility(dni, ref),
      this.powerbiProvider.checkEligibility(dni, ref),
    ]);

    // 2. Evaluate results
    const evaluation = evaluateResults({
      fnb: fnbResult,
      powerbi: powerbiResult,
    });

    // 3. Handle evaluation result
    if (isErr(evaluation)) {
      // If system outage, emit event
      await asyncEmitter.emitCritical(
        createEvent(
          "system_outage_detected",
          {
            dni,
            errors: [
              evaluation.error.fnbError.message,
              evaluation.error.powerbiError.message,
            ],
            timestamp: Date.now(),
          },
          eventContext,
        ),
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
      asyncEmitter.emitAsync(
        createEvent(
          "provider_degraded",
          {
            failedProvider: warning.failedProvider,
            workingProvider: warning.workingProvider,
            dni,
            errors: warning.errors,
          },
          eventContext,
        ),
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
          tenantId: ref?.tenantId,
          phoneNumber: ref?.phoneNumber,
          source: evaluation.value.source,
          credit: evaluation.value.result.credit,
          name: evaluation.value.result.name,
        },
        "Customer eligible",
      );
    }

    // 6. Map to enrichment result. Bundles offered come from the tenant that
    //    owns the conversation; with no conversation (the admin DNI lookup)
    //    there is no catalog to draw from, and null says so - the empty string
    //    this used to pass reached the catalog query as a tenant id matching
    //    nothing, which reads as an empty catalog rather than as no question.
    const enrichmentResult = mapEligibilityToEnrichment(ref?.tenantId ?? null, {
      ...evaluation.value.result,
      needsHuman: false,
    });

    return { ok: true, value: enrichmentResult };
  }
}

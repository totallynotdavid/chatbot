import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";
import { safeShouldEscalate } from "../../../intelligence/wrapper.ts";

export class ShouldEscalateHandler
  implements
    EnrichmentHandler<
      Extract<EnrichmentRequest, { type: "should_escalate" }>,
      Extract<EnrichmentResult, { type: "escalation_needed" }>
    >
{
  readonly type = "should_escalate" as const;

  async execute(
    request: Extract<EnrichmentRequest, { type: "should_escalate" }>,
    context: EnrichmentContext,
  ): Promise<Extract<EnrichmentResult, { type: "escalation_needed" }>> {
    const shouldEscalate = await safeShouldEscalate(
      context.provider,
      request.message,
      context.phoneNumber,
    );

    return {
      type: "escalation_needed",
      shouldEscalate,
    };
  }
}

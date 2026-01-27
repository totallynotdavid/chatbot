import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";

/**
 * Detects if a message requires human escalation.
 *
 * Identifies complaints, sensitive topics, or situations beyond bot capability.
 *
 * Used throughout conversation to identify when to transfer to human agent.
 */
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
    const shouldEscalate = await context.provider.shouldEscalate(
      request.message,
    );

    return {
      type: "escalation_needed",
      shouldEscalate,
    };
  }
}

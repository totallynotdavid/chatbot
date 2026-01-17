import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";
import { safeHandleBacklogResponse } from "../../../intelligence/wrapper.ts";

/**
 * Generates a personalized apology for delayed responses based on delay duration
 * and message context.
 *
 * Triggered when the bot responds after a significant backlog delay.
 */
export class GenerateBacklogApologyHandler
  implements
    EnrichmentHandler<
      Extract<EnrichmentRequest, { type: "generate_backlog_apology" }>,
      Extract<EnrichmentResult, { type: "backlog_apology" }>
    >
{
  readonly type = "generate_backlog_apology" as const;

  async execute(
    request: Extract<EnrichmentRequest, { type: "generate_backlog_apology" }>,
    context: EnrichmentContext,
  ): Promise<Extract<EnrichmentResult, { type: "backlog_apology" }>> {
    const apology = await safeHandleBacklogResponse(
      context.provider,
      request.message,
      request.ageMinutes,
      context.phoneNumber,
    );

    return {
      type: "backlog_apology",
      apology: apology || "Disculpa la demora, recién vi tu mensaje.",
    };
  }
}

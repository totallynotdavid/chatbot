import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";
import { safeRecoverUnclearResponse } from "../../../intelligence/wrapper.ts";

/**
 * Recovers from unclear or ambiguous customer responses.
 *
 * Generates a clarification message when the response does not match
 * expected options or is ambiguous in context.
 *
 * Triggered when a customer provides an unclear response to a specific question.
 */
export class RecoverUnclearResponseHandler
  implements
    EnrichmentHandler<
      Extract<EnrichmentRequest, { type: "recover_unclear_response" }>,
      Extract<EnrichmentResult, { type: "recovery_response" }>
    >
{
  readonly type = "recover_unclear_response" as const;

  async execute(
    request: Extract<EnrichmentRequest, { type: "recover_unclear_response" }>,
    context: EnrichmentContext,
  ): Promise<Extract<EnrichmentResult, { type: "recovery_response" }>> {
    const recoveryText = await safeRecoverUnclearResponse(
      context.provider,
      request.message,
      request.context,
      context.phoneNumber,
    );

    return {
      type: "recovery_response",
      text: recoveryText,
    };
  }
}

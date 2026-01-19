import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";
import { LLM } from "../../../intelligence/service.ts";

/**
 * Detects if message is requesting products/categories.
 *
 * Used to identify when to show products vs general conversation.
 */
export class IsProductRequestHandler
  implements
    EnrichmentHandler<
      Extract<EnrichmentRequest, { type: "is_product_request" }>,
      Extract<EnrichmentResult, { type: "product_request_detected" }>
    >
{
  readonly type = "is_product_request" as const;

  async execute(
    request: Extract<EnrichmentRequest, { type: "is_product_request" }>,
    context: EnrichmentContext,
  ): Promise<Extract<EnrichmentResult, { type: "product_request_detected" }>> {
    const isProductRequest = await LLM.isProductRequest(
      request.message,
      context.phoneNumber,
    );

    return {
      type: "product_request_detected",
      isProductRequest,
    };
  }
}

import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";
import { safeIsProductRequest } from "../../../intelligence/wrapper.ts";

/**
 * Detects product browsing intent in customer messages.
 *
 * Used to transition from greeting or other phases into the product offering flow.
 *
 * Triggered when the state machine must detect product browsing intent.
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
    const isProductRequest = await safeIsProductRequest(
      context.provider,
      request.message,
      context.phoneNumber,
    );

    return {
      type: "product_request_detected",
      isProductRequest,
    };
  }
}

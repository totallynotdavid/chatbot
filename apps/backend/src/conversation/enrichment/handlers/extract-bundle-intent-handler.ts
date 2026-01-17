import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";
import { safeExtractBundleIntent } from "../../../intelligence/wrapper.ts";

/**
 * Extracts bundle selection intent from a customer message.
 *
 * Uses an LLM to match the response to offered bundles and returns the
 * selected bundle with a confidence score.
 *
 * Triggered when a customer responds to bundle offerings with selection intent.
 */
export class ExtractBundleIntentHandler
  implements
    EnrichmentHandler<
      Extract<EnrichmentRequest, { type: "extract_bundle_intent" }>,
      Extract<EnrichmentResult, { type: "bundle_intent_extracted" }>
    >
{
  readonly type = "extract_bundle_intent" as const;

  async execute(
    request: Extract<EnrichmentRequest, { type: "extract_bundle_intent" }>,
    context: EnrichmentContext,
  ): Promise<Extract<EnrichmentResult, { type: "bundle_intent_extracted" }>> {
    const segment = "fnb";
    const maxPrice =
      request.affordableBundles.length > 0
        ? Math.max(...request.affordableBundles.map((b) => b.price))
        : 0;

    const result = await safeExtractBundleIntent(
      context.provider,
      request.message,
      context.phoneNumber,
      segment as "fnb" | "gaso",
      maxPrice,
    );

    return {
      type: "bundle_intent_extracted",
      bundle: result.bundle,
      confidence: result.confidence,
    };
  }
}

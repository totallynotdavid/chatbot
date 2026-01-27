import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";

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
    const result = await context.provider.extractBundleIntent(
      request.message,
      request.affordableBundles,
    );

    return {
      type: "bundle_intent_extracted",
      bundle: result.bundle,
      confidence: result.confidence,
    };
  }
}

import type { EnrichmentRequest, EnrichmentResult } from "@vendeya/core";
import type { IntelligenceProvider } from "@vendeya/intelligence";
import type { ConversationRef } from "@vendeya/types";

/**
 * Context passed to all enrichment handlers.
 */
export interface EnrichmentContext {
  /** Tenant, channel account and contact this enrichment is running for. */
  ref: ConversationRef;
  provider: IntelligenceProvider;
}

/**
 * Interface that all enrichment handlers must implement.
 * Uses TypeScript generics to ensure type safety between request and result types.
 */
export interface EnrichmentHandler<
  TRequest extends EnrichmentRequest,
  TResult extends EnrichmentResult,
> {
  readonly type: TRequest["type"];

  execute(request: TRequest, context: EnrichmentContext): Promise<TResult>;
}

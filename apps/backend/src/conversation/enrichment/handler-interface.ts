import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type { IntelligenceProvider } from "@totem/intelligence";

/**
 * Context passed to all enrichment handlers.
 */
export interface EnrichmentContext {
  phoneNumber: string;
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

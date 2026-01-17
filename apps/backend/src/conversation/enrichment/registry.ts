import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type { EnrichmentHandler } from "./handler-interface.ts";

/**
 * Registry that maps enrichment types to their handlers.
 */
export class EnrichmentHandlerRegistry {
  private handlers = new Map<string, EnrichmentHandler<any, any>>();

  /**
   * Register a handler for an enrichment type.
   * Throws if a handler is already registered for the same type.
   */
  register(handler: EnrichmentHandler<any, any>): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(
        `Handler already registered for enrichment type: ${handler.type}`,
      );
    }
    this.handlers.set(handler.type, handler);
  }

  /**
   * Get the handler for a specific enrichment type.
   * Throws if no handler is registered for the type.
   */
  get<T extends EnrichmentRequest>(
    type: T["type"],
  ): EnrichmentHandler<T, Extract<EnrichmentResult, { type: string }>> {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler registered for enrichment type: ${type}`);
    }
    return handler;
  }
}

export const enrichmentRegistry = new EnrichmentHandlerRegistry();

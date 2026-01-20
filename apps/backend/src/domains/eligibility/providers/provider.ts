import type { Result } from "../../../shared/result/index.ts";
import type { ProviderCheckResult } from "@totem/types";

/**
 * Unified interface for eligibility providers.
 * All providers must return Result to make errors explicit.
 */
export interface EligibilityProvider {
  readonly name: string;

  checkEligibility(
    dni: string,
    phoneNumber?: string,
  ): Promise<Result<ProviderCheckResult, ProviderError>>;
}

/**
 * Provider-specific errors
 */
export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly reason: "api_error" | "unavailable" | "forced_down",
    message: string,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

import type { Result } from "../../../shared/result/index.ts";
import type { ProviderCheckResult } from "@totem/types";
import type { ProviderError } from "../providers/provider.ts";

export type ProviderResults = {
  fnb: Result<ProviderCheckResult, ProviderError>;
  powerbi: Result<ProviderCheckResult, ProviderError>;
};

export type DegradationWarning = {
  failedProvider: string;
  workingProvider: string;
  errors: string[];
};

export type EligibilityEvaluation = {
  result: ProviderCheckResult;
  source: "fnb" | "powerbi";
  warnings?: DegradationWarning[];
};

export class SystemOutageError extends Error {
  constructor(
    public readonly fnbError: ProviderError,
    public readonly powerbiError: ProviderError,
  ) {
    super("System Outage: Both providers failed");
    this.name = "SystemOutageError";
  }
}

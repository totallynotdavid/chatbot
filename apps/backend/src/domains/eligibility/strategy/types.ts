import type { Result } from "../../../shared/result/index.ts";
import type { ProviderCheckResult } from "@totem/types";
import type { ProviderError } from "../providers/provider.ts";

/**
 * Results from both providers
 */
export type ProviderResults = {
    fnb: Result<ProviderCheckResult, ProviderError>;
    powerbi: Result<ProviderCheckResult, ProviderError>;
};

/**
 * Strategy evaluation outcome
 */
export type EligibilityEvaluation = {
    result: ProviderCheckResult;
    source: "fnb" | "powerbi";
    warnings?: DegradationWarning[];
};

/**
 * Warnings about degraded service
 */
export type DegradationWarning = {
    failedProvider: string;
    workingProvider: string;
    errors: string[];
};

/**
 * System outage error (both providers down)
 */
export class SystemOutageError extends Error {
    constructor(
        public readonly fnbError: ProviderError,
        public readonly powerbiError: ProviderError,
    ) {
        super("Both eligibility providers are down");
        this.name = "SystemOutageError";
    }
}

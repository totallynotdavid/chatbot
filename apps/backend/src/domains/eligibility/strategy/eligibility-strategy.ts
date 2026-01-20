import type { Result } from "../../../shared/result/index.ts";
import { Ok, Err, isErr } from "../../../shared/result/index.ts";
import type { ProviderCheckResult } from "@totem/types";
import type {
    ProviderResults,
    EligibilityEvaluation,
    SystemOutageError,
} from "./types.ts";

/**
 * Pure function: evaluates provider results and determines eligibility.
 * NO SIDE EFFECTS — events are emitted by the handler.
 */
export function evaluateResults(
    results: ProviderResults,
): Result<EligibilityEvaluation, SystemOutageError> {
    const fnbFailed = isTechnicalFailure(results.fnb);
    const powerbiFailed = isTechnicalFailure(results.powerbi);

    // Case 1: Both providers down → System outage
    if (fnbFailed && powerbiFailed) {
        return Err(
            new (await import("./types.ts")).SystemOutageError(
                results.fnb.error,
                results.powerbi.error,
            ),
        );
    }

    // Case 2: FNB available
    if (!fnbFailed && results.fnb.ok) {
        const warnings = powerbiFailed
            ? [
                {
                    failedProvider: "PowerBI",
                    workingProvider: "FNB",
                    errors: [results.powerbi.error.message],
                },
            ]
            : undefined;

        return Ok({
            result: results.fnb.value,
            source: "fnb" as const,
            warnings,
        });
    }

    // Case 3: PowerBI available (FNB failed or not eligible)
    if (!powerbiFailed && results.powerbi.ok) {
        const warnings = fnbFailed
            ? [
                {
                    failedProvider: "FNB",
                    workingProvider: "PowerBI",
                    errors: [results.fnb.error.message],
                },
            ]
            : undefined;

        return Ok({
            result: results.powerbi.value,
            source: "powerbi" as const,
            warnings,
        });
    }

    // Case 4: Both returned not eligible
    return Ok({
        result: { eligible: false, credit: 0, reason: "not_qualified" },
        source: "fnb" as const,
    });
}

function isTechnicalFailure(
    result: Result<ProviderCheckResult, any>,
): boolean {
    if (isErr(result)) return true;

    const reason = result.value.reason;
    return (
        reason === "api_error" ||
        reason === "provider_unavailable" ||
        reason === "provider_forced_down"
    );
}

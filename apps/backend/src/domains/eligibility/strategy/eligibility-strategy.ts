import type { Result } from "../../../shared/result/index.ts";
import { Ok, Err, isErr } from "../../../shared/result/index.ts";
import type { ProviderCheckResult } from "@totem/types";
import type { ProviderResults, EligibilityEvaluation } from "./types.ts";
import { SystemOutageError } from "./types.ts";
import type { ProviderError } from "../providers/provider.ts";

function isProviderError<T>(
  result: Result<T, ProviderError>,
): result is { ok: false; error: ProviderError } {
  return isErr(result);
}

export function evaluateResults(
  results: ProviderResults,
): Result<EligibilityEvaluation, SystemOutageError> {
  const fnbFailed = isTechnicalFailure(results.fnb);
  const powerbiFailed = isTechnicalFailure(results.powerbi);

  // Case 1: Both providers are down
  if (fnbFailed && powerbiFailed) {
    const fnbError = isProviderError(results.fnb)
      ? results.fnb.error
      : new Error("FNB failed with unknown error");
    const powerbiError = isProviderError(results.powerbi)
      ? results.powerbi.error
      : new Error("PowerBI failed with unknown error");

    return Err(
      new SystemOutageError(
        fnbError as ProviderError,
        powerbiError as ProviderError,
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
            errors: isProviderError(results.powerbi)
              ? [results.powerbi.error.message]
              : ["Unknown error"],
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
            errors: isProviderError(results.fnb)
              ? [results.fnb.error.message]
              : ["Unknown error"],
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

function isTechnicalFailure(result: Result<ProviderCheckResult, any>): boolean {
  if (isErr(result)) return true;

  const reason = result.value.reason;
  return (
    reason === "api_error" ||
    reason === "provider_unavailable" ||
    reason === "provider_forced_down"
  );
}

import type { Result } from "../../../shared/result/index.ts";
import { Ok, Err, isErr } from "../../../shared/result/index.ts";
import type { ProviderCheckResult } from "@vendeya/types";
import type {
  DegradationWarning,
  EligibilityEvaluation,
  ProviderResults,
} from "./types.ts";
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

  const fnbWarning = fnbFailed
    ? degradation("FNB", "PowerBI", results.fnb)
    : undefined;
  const powerbiWarning = powerbiFailed
    ? degradation("PowerBI", "FNB", results.powerbi)
    : undefined;

  // Case 2: FNB approves
  if (results.fnb.ok && !fnbFailed && results.fnb.value.eligible) {
    return Ok({
      result: results.fnb.value,
      source: "fnb" as const,
      warnings: powerbiWarning && [powerbiWarning],
    });
  }

  // Case 3: Power BI approves (FNB failed or refused)
  if (results.powerbi.ok && !powerbiFailed && results.powerbi.value.eligible) {
    return Ok({
      result: results.powerbi.value,
      source: "powerbi" as const,
      warnings: fnbWarning && [fnbWarning],
    });
  }

  // Case 4: whoever answered refused. One provider down is not an outage here.
  const warning = fnbWarning ?? powerbiWarning;
  return Ok({
    result: { eligible: false, credit: 0, reason: "not_qualified" },
    source: fnbFailed ? ("powerbi" as const) : ("fnb" as const),
    warnings: warning && [warning],
  });
}

function degradation(
  failedProvider: string,
  workingProvider: string,
  result: Result<ProviderCheckResult, ProviderError>,
): DegradationWarning {
  return {
    failedProvider,
    workingProvider,
    errors: isProviderError(result)
      ? [result.error.message]
      : [`${failedProvider} answered ${result.value.reason}`],
  };
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

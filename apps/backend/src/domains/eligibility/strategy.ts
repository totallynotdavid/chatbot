import type { ProviderCheckResult } from "@totem/types";
import { notifyTeam } from "../../adapters/notifier/client.ts";
import { createLogger } from "../../lib/logger.ts";
import type { EligibilityResult } from "./types.ts";
import type { ProviderResults } from "./checks.ts";

const logger = createLogger("eligibility-strategy");

export function evaluateResults(
  dni: string,
  results: ProviderResults,
): EligibilityResult {
  const fnbTechFail = isTechnicalFailure(results.fnb);
  const gasoTechFail = isTechnicalFailure(results.powerbi);

  // 1. Both providers failed technically
  if (fnbTechFail && gasoTechFail) {
    logger.error(
      { dni, errors: results.errors },
      "System Outage: Both providers failed",
    );
    return {
      eligible: false,
      credit: 0,
      reason: "system_outage",
      needsHuman: true,
      handoffReason: "both_providers_down",
    };
  }

  // 2. FNB available and valid
  if (!fnbTechFail && results.fnb?.success && results.fnb.result) {
    // If GASO failed, notify
    if (gasoTechFail) {
      silentlyNotifyDev(`PowerBI down/error, using FNB`, dni, results.errors);
    }

    if (results.fnb.result.eligible) {
      if (gasoTechFail) logger.warn("Eligible (PowerBI degraded)");
      else logger.info("Eligible via FNB");
      return results.fnb.result;
    }
    // FNB explicit not eligible.
    // If GASO is available and eligible, we might consider it?
    // Original logic: "Check FNB first... FNB not eligible, try GASO"
  }

  // 3. GASO available (and FNB either failed or was not eligible)
  if (!gasoTechFail && results.powerbi?.success && results.powerbi.result) {
    const fnbWasDown = fnbTechFail;

    if (fnbWasDown) {
      silentlyNotifyDev(`FNB down/error, using PowerBI`, dni, results.errors);
    }

    if (results.powerbi.result.eligible) {
      if (fnbWasDown) logger.warn("Eligible (FNB degraded)");
      else logger.info("Eligible via GASO");
      return results.powerbi.result;
    }
  }

  // 4. Default: Not eligible
  return { eligible: false, credit: 0, reason: "not_qualified" };
}

function isTechnicalFailure(
  providerResult: { success: boolean; result?: ProviderCheckResult } | null,
): boolean {
  if (!providerResult?.success) return true;
  if (!providerResult.result) return true;
  const reason = providerResult.result.reason;
  return (
    reason === "api_error" ||
    reason === "provider_unavailable" ||
    reason === "provider_forced_down"
  );
}

function silentlyNotifyDev(
  message: string,
  dni: string,
  errors: string[],
): void {
  notifyTeam(
    "dev",
    `${message}\nDNI: ${dni}\nErrors: ${errors.join(", ")}`,
  ).catch(() => {});
}

import type { ProviderCheckResult } from "@totem/types";
import { checkFNB, checkGASO } from "./check.ts";
import { health } from "../../services/providers/health.ts";

export async function checkEligibilityWithFallback(
  dni: string,
  phoneNumber?: string,
): Promise<ProviderCheckResult> {
  // Try FNB first
  const fnbResult = await checkFNB(dni, phoneNumber);
  
  if (fnbResult.eligible) {
    return fnbResult;
  }

  // If FNB unavailable, try GASO
  if (fnbResult.reason === "provider_unavailable") {
    console.log(`[Orchestrator] FNB unavailable, trying GASO for DNI ${dni}`);
    return await checkGASO(dni, phoneNumber);
  }

  // FNB didn't find the client - try GASO
  console.log(`[Orchestrator] Not found in FNB, trying GASO for DNI ${dni}`);
  const gasoResult = await checkGASO(dni, phoneNumber);

  // If GASO also unavailable and we already tried FNB, use FNB as fallback
  if (gasoResult.reason === "provider_unavailable" && health.isAvailable("fnb")) {
    console.log(`[Orchestrator] GASO unavailable, using FNB fallback for DNI ${dni}`);
    return fnbResult; // Return FNB result (even if not found)
  }

  return gasoResult;
}

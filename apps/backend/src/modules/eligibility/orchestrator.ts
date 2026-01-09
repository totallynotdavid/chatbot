import type { ProviderCheckResult } from "@totem/types";
import { checkFNB } from "./fnb.ts";
import { checkGASO } from "./gaso.ts";
import { notifyTeam } from "../../services/notifier.ts";

type ProviderResult = {
  success: boolean;
  result?: ProviderCheckResult;
  error?: string;
};

type EligibilityResult = ProviderCheckResult & {
  needsHuman?: boolean;
  handoffReason?: string;
};

export async function checkEligibilityWithFallback(
  dni: string,
  phoneNumber?: string,
): Promise<EligibilityResult> {
  const results = {
    fnb: null as ProviderResult | null,
    powerbi: null as ProviderResult | null,
    errors: [] as string[],
  };

  // Try both providers in parallel (fail-fast)
  await Promise.allSettled([
    checkFNB(dni, phoneNumber)
      .then((result) => {
        results.fnb = { success: true, result };
      })
      .catch((error) => {
        results.fnb = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        results.errors.push(`FNB: ${results.fnb.error}`);
      }),

    checkGASO(dni, phoneNumber)
      .then((result) => {
        results.powerbi = { success: true, result };
      })
      .catch((error) => {
        results.powerbi = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        results.errors.push(`PowerBI: ${results.powerbi.error}`);
      }),
  ]);

  // Best case: Both succeeded
  if (results.fnb?.success && results.powerbi?.success) {
    const fnbResult = results.fnb.result!;
    const gasoResult = results.powerbi.result!;

    // Check FNB first (premium segment priority)
    if (fnbResult.eligible) {
      console.log(`[Orchestrator] Customer eligible via FNB: ${dni}`);
      return fnbResult;
    }

    // FNB not eligible, try GASO
    if (gasoResult.eligible) {
      console.log(`[Orchestrator] Customer eligible via GASO: ${dni}`);
      return gasoResult;
    }

    // Neither eligible
    console.log(`[Orchestrator] Customer not eligible in any segment: ${dni}`);
    return { eligible: false, credit: 0, reason: "not_qualified" };
  }

  // FNB succeeded, PowerBI failed, so we use FNB data
  if (results.fnb?.success && !results.powerbi?.success) {
    silentlyNotifyDev(`PowerBI down, using FNB data only`, dni, results.errors);

    const fnbResult = results.fnb.result!;
    if (fnbResult.eligible) {
      console.log(
        `[Orchestrator] Customer eligible via FNB (PowerBI degraded): ${dni}`,
      );
      return fnbResult;
    }

    // FNB says not found, customer likely is not a Calidda customer
    console.log(
      `[Orchestrator] FNB returned not found (PowerBI unavailable): ${dni}`,
    );
    return { eligible: false, credit: 0, reason: "not_qualified" };
  }

  // PowerBI succeeded, FNB failed, so we use PowerBI data
  if (!results.fnb?.success && results.powerbi?.success) {
    silentlyNotifyDev(
      `FNB platform down, using PowerBI only`,
      dni,
      results.errors,
    );

    const gasoResult = results.powerbi.result!;
    if (gasoResult.eligible) {
      console.log(
        `[Orchestrator] Customer eligible via PowerBI (FNB degraded): ${dni}`,
      );
      return gasoResult;
    }

    console.log(
      `[Orchestrator] Customer not eligible (FNB unavailable): ${dni}`,
    );
    return { eligible: false, credit: 0, reason: "not_qualified" };
  }

  // If both providers fail, we escalate
  console.error(
    `[Orchestrator] CRITICAL: Both providers failed for DNI ${dni}`,
  );

  await escalateToHuman(
    `URGENTE: Ambos proveedores caídos. Cliente esperando: DNI ${dni}${phoneNumber ? `, WhatsApp ${phoneNumber}` : ""}`,
  );

  return {
    eligible: false,
    credit: 0,
    reason: "provider_unavailable",
    needsHuman: true,
    handoffReason: "both_providers_down",
  };
}

function silentlyNotifyDev(
  message: string,
  dni: string,
  errors: string[],
): void {
  console.warn(`[Orchestrator] ${message} for DNI ${dni}`);

  notifyTeam(
    "dev",
    `${message}\nDNI: ${dni}\nErrors: ${errors.join(", ")}`,
  ).catch((error) => {
    console.error("[Orchestrator] Failed to notify dev:", error);
  });
}

async function escalateToHuman(message: string): Promise<void> {
  try {
    await notifyTeam("agent", message);
  } catch (error) {
    console.error("[Orchestrator] Failed to escalate to human:", error);
    await notifyTeam("dev", `Escalation failed: ${message}`).catch(() => {});
  }
}

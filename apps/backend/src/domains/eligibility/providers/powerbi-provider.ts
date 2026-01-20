import type { Result } from "../../../shared/result/index.ts";
import { Ok, Err } from "../../../shared/result/index.ts";
import { PowerBIClient } from "../../../adapters/providers/powerbi-client.ts";
import {
  isAvailable,
  markBlocked,
} from "../../../adapters/providers/health.ts";
import { isProviderForcedDown } from "../../settings/system.ts";
import { getSimulationPersona } from "../shared.ts";
import { PersonasService } from "../../personas/index.ts";
import type { EligibilityProvider } from "./provider.ts";
import { ProviderError } from "./provider.ts";
import type { ProviderCheckResult } from "@totem/types";
import { createLogger } from "../../../lib/logger.ts";

const logger = createLogger("powerbi-provider");

function parseCreditString(saldoStr: string | undefined): number {
  if (!saldoStr || typeof saldoStr !== "string" || saldoStr === "undefined") {
    return 0;
  }
  const clean = saldoStr
    .replace("S/", "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  return parseFloat(clean) || 0;
}

export class PowerBIProvider implements EligibilityProvider {
  readonly name = "PowerBI";

  async checkEligibility(
    dni: string,
    phoneNumber?: string,
  ): Promise<Result<ProviderCheckResult, ProviderError>> {
    // Check for simulation persona
    if (phoneNumber) {
      const persona = await getSimulationPersona(phoneNumber);
      if (persona) {
        logger.debug({ dni, persona: persona.name }, "Using test persona");
        return Ok(PersonasService.toProviderResult(persona));
      }
    }

    // Check forced shutdown
    if (isProviderForcedDown("gaso")) {
      logger.debug({ dni }, "Provider forced down");
      return Err(
        new ProviderError("PowerBI", "forced_down", "Provider forced down"),
      );
    }

    // Check circuit breaker
    if (!isAvailable("powerbi")) {
      logger.debug({ dni }, "Provider unavailable (circuit breaker)");
      return Err(
        new ProviderError("PowerBI", "unavailable", "Circuit breaker open"),
      );
    }

    // Perform check
    try {
      const { estado, nombre, saldoStr, nseStr } =
        await PowerBIClient.queryAll(dni);

      // All fields empty => provider unavailable
      if (!estado && !nombre && !saldoStr && !nseStr) {
        return Err(
          new ProviderError("PowerBI", "unavailable", "No data returned"),
        );
      }

      // Not eligible
      if (!estado || estado === "--" || estado === "NO APLICA") {
        const credit = parseCreditString(saldoStr);
        return Ok({
          eligible: false,
          credit,
          reason: credit === 0 ? "no_credit_line" : "not_eligible_per_calidda",
          name: nombre,
        });
      }

      // Eligible
      const credit = parseCreditString(saldoStr);
      const nse =
        nseStr && nseStr !== "undefined" ? parseInt(nseStr, 10) : undefined;

      return Ok({ eligible: true, credit, name: nombre, nse });
    } catch (error) {
      logger.error({ error, dni }, "PowerBI query failed");

      // Mark as blocked if auth error
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (
          msg.includes("auth") ||
          msg.includes("401") ||
          msg.includes("403")
        ) {
          markBlocked("powerbi", error.message);
        }
      }

      return Err(
        new ProviderError(
          "PowerBI",
          "api_error",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
}

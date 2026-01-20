import type { Result } from "../../../shared/result/index.ts";
import { Ok, Err } from "../../../shared/result/index.ts";
import { FNBClient } from "../../../adapters/providers/fnb-client.ts";
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

const logger = createLogger("fnb-provider");

export class FNBProvider implements EligibilityProvider {
  readonly name = "FNB";

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
    if (isProviderForcedDown("fnb")) {
      logger.debug({ dni }, "Provider forced down");
      return Err(
        new ProviderError("FNB", "forced_down", "Provider forced down"),
      );
    }

    // Check circuit breaker
    if (!isAvailable("fnb")) {
      logger.debug({ dni }, "Provider unavailable (circuit breaker)");
      return Err(
        new ProviderError("FNB", "unavailable", "Circuit breaker open"),
      );
    }

    // Perform check
    try {
      const data = await FNBClient.queryCreditLine(dni);

      if (!(data.valid && data.data)) {
        return Ok({ eligible: false, credit: 0, name: undefined });
      }

      const credit = parseFloat(data.data.lineaCredito || "0");
      logger.info({ dni, credit, name: data.data.nombre }, "Credit found");

      return Ok({ eligible: true, credit, name: data.data.nombre });
    } catch (error) {
      logger.error({ error, dni }, "Credit check failed");

      // Mark as blocked if auth error
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (
          msg.includes("auth") ||
          msg.includes("401") ||
          msg.includes("403") ||
          msg.includes("bloqueado")
        ) {
          markBlocked("fnb", error.message);
        }
      }

      return Err(
        new ProviderError(
          "FNB",
          "api_error",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
}

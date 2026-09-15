import type { ConversationRef, ProviderCheckResult } from "@totem/types";
import { FNBClient } from "../../adapters/providers/fnb-client.ts";
import { isAvailable, markBlocked } from "../../adapters/providers/health.ts";
import { PersonasService } from "../../domains/personas/index.ts";
import { isProviderForcedDown } from "../settings/system.ts";
import { getSimulationPersona } from "./shared.ts";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("eligibility");

export async function checkFNB(
  dni: string,
  ref?: ConversationRef,
): Promise<ProviderCheckResult> {
  if (ref) {
    const persona = await getSimulationPersona(ref);
    if (persona) {
      logger.debug({ dni, persona: persona.name }, "Test persona");
      return PersonasService.toProviderResult(persona);
    }
  }

  if (isProviderForcedDown("fnb")) {
    logger.debug({ dni }, "Provider forced down");
    return { eligible: false, credit: 0, reason: "provider_forced_down" };
  }

  if (!isAvailable("fnb")) {
    logger.debug({ dni }, "Provider unavailable");
    return { eligible: false, credit: 0, reason: "provider_unavailable" };
  }

  try {
    const data = await FNBClient.queryCreditLine(dni);

    if (!(data.valid && data.data)) {
      return { eligible: false, credit: 0, name: undefined };
    }

    const credit = parseFloat(data.data.lineaCredito || "0");
    logger.info({ dni, credit, name: data.data.nombre }, "Credit found");

    return { eligible: true, credit, name: data.data.nombre };
  } catch (error) {
    logger.error({ error, dni }, "Credit check failed");

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

    return { eligible: false, credit: 0, reason: "api_error" };
  }
}

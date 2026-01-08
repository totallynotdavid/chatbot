import type { ProviderCheckResult } from "@totem/types";
import { FNBClient } from "../../services/providers/fnb-client.ts";
import { PowerBIClient } from "../../services/providers/powerbi-client.ts";
import { health } from "../../services/providers/health.ts";
import { PersonasService } from "../../services/personas.ts";
import { getOne } from "../../db/query.ts";
import { isProviderForcedDown } from "../settings/system.ts";

type ConversationRow = {
  is_simulation: number;
  persona_id: string | null;
};

async function getSimulationPersona(phoneNumber: string) {
  const conv = getOne<ConversationRow>(
    "SELECT is_simulation, persona_id FROM conversations WHERE phone_number = ?",
    [phoneNumber],
  );

  if (conv?.is_simulation === 1 && conv.persona_id) {
    return PersonasService.getById(conv.persona_id);
  }
  return null;
}

export async function checkFNB(
  dni: string,
  phoneNumber?: string,
): Promise<ProviderCheckResult> {
  // Check simulation
  if (phoneNumber) {
    const persona = await getSimulationPersona(phoneNumber);
    if (persona) {
      console.log(`[FNB] Using test persona: ${persona.name}`);
      return PersonasService.toProviderResult(persona);
    }
  }

  // Check if admin forced down
  if (isProviderForcedDown("fnb")) {
    console.log(`[FNB] Provider forced down by admin for DNI ${dni}`);
    return {
      eligible: false,
      credit: 0,
      reason: "provider_forced_down",
    };
  }

  // Check health
  if (!health.isAvailable("fnb")) {
    console.log(`[FNB] Provider unavailable for DNI ${dni}`);
    return {
      eligible: false,
      credit: 0,
      reason: "provider_unavailable",
    };
  }

  // Query provider
  try {
    console.log(`[FNB] Checking credit for DNI ${dni}...`);
    const data = await FNBClient.queryCreditLine(dni);

    if (!(data.valid && data.data)) {
      console.log(`[FNB] No data found for DNI ${dni}`);
      return { eligible: false, credit: 0, name: undefined };
    }

    const credit = parseFloat(data.data.lineaCredito || "0");
    console.log(
      `[FNB] Found credit for DNI ${dni}: S/ ${credit}, Name: ${data.data.nombre}`,
    );
    
    return {
      eligible: true,
      credit,
      name: data.data.nombre,
    };
  } catch (error) {
    console.error(`[FNB] Error checking credit for DNI ${dni}:`, error);

    // Mark as blocked on auth failures
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("auth") ||
        msg.includes("401") ||
        msg.includes("403") ||
        msg.includes("bloqueado")
      ) {
        health.markBlocked("fnb", error.message);
      }
    }

    return { eligible: false, credit: 0, reason: "api_error" };
  }
}

export async function checkGASO(
  dni: string,
  phoneNumber?: string,
): Promise<ProviderCheckResult> {
  // Check simulation
  if (phoneNumber) {
    const persona = await getSimulationPersona(phoneNumber);
    if (persona) {
      console.log(`[GASO] Using test persona: ${persona.name}`);
      return PersonasService.toProviderResult(persona);
    }
  }

  // Check if admin forced down
  if (isProviderForcedDown("gaso")) {
    console.log(`[GASO] Provider forced down by admin for DNI ${dni}`);
    return {
      eligible: false,
      credit: 0,
      reason: "provider_forced_down",
    };
  }

  // Check health - if PowerBI down, use orchestrator fallback
  if (!health.isAvailable("powerbi")) {
    console.log(`[GASO] PowerBI unavailable, using fallback for DNI ${dni}`);
    return { eligible: false, credit: 0, reason: "provider_unavailable" };
  }

  // Query PowerBI
  try {
    const { estado, nombre, saldoStr, nseStr } =
      await PowerBIClient.queryAll(dni);

    // If ALL fields undefined, PowerBI is completely down
    if (!estado && !nombre && !saldoStr && !nseStr) {
      console.log(`[GASO] PowerBI returned no data for DNI ${dni}`);
      return { eligible: false, credit: 0, reason: "provider_unavailable" };
    }

    // Check Estado field - primary eligibility gate
    if (!estado || estado === "--" || estado === "NO APLICA") {
      let credit = 0;
      if (saldoStr && typeof saldoStr === "string" && saldoStr !== "undefined") {
        const clean = saldoStr
          .replace("S/", "")
          .trim()
          .replace(/\./g, "")
          .replace(",", ".");
        credit = parseFloat(clean) || 0;
      }

      return {
        eligible: false,
        credit,
        reason: credit === 0 ? "no_credit_line" : "not_eligible_per_calidda",
        name: nombre,
      };
    }

    // Estado is positive - client is eligible
    let credit = 0;
    if (saldoStr && typeof saldoStr === "string" && saldoStr !== "undefined") {
      const clean = saldoStr
        .replace("S/", "")
        .trim()
        .replace(/\./g, "")
        .replace(",", ".");
      credit = parseFloat(clean) || 0;
    }

    const nse =
      nseStr && nseStr !== "undefined" ? parseInt(nseStr, 10) : undefined;

    return {
      eligible: true,
      credit,
      name: nombre,
      nse,
    };
  } catch (error) {
    console.error("[GASO] Error:", error);

    // Mark as blocked on auth failures
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("auth") ||
        msg.includes("401") ||
        msg.includes("403")
      ) {
        health.markBlocked("powerbi", error.message);
      }
    }

    return { eligible: false, credit: 0, reason: "api_error" };
  }
}

import jwt from "jsonwebtoken";
import process from "node:process";
import type { ProviderCheckResult } from "@totem/types";
import { db } from "../db/index.ts";
import { PersonasService } from "./personas.ts";

type FNBSession = { token: string; allyId: string; expiresAt: Date };
let fnbSession: FNBSession | null = null;

type FNBAuthResponse = {
  valid: boolean;
  message?: string;
  data?: {
    authToken: string;
  };
};

type FNBCreditResponse = {
  valid: boolean;
  data?: {
    lineaCredito?: string;
    nombre?: string;
  };
};

type PowerBIResponse = {
  results?: Array<{
    result?: {
      data?: {
        dsr?: {
          DS?: Array<{
            PH?: Array<{
              DM0?: Array<{
                M0?: unknown;
              }>;
            }>;
          }>;
        };
      };
    };
  }>;
};

type JwtPayload = {
  commercialAllyId: string;
};

// Simple health tracking
type ProviderHealth = {
  status: "healthy" | "blocked";
  lastError: string | null;
  blockedUntil: Date | null;
};

const fnbHealth: ProviderHealth = {
  status: "healthy",
  lastError: null,
  blockedUntil: null,
};
const gasoHealth: ProviderHealth = {
  status: "healthy",
  lastError: null,
  blockedUntil: null,
};

const BLOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

const powerBIHealth: ProviderHealth = {
  status: "healthy",
  lastError: null,
  blockedUntil: null,
};

let powerBIDownNotified = false; // Track if we've already notified about PowerBI being down

// Check admin settings for provider force-down toggles
function getSystemSetting(key: string): string | null {
  const row = db
    .prepare("SELECT value FROM system_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function isProviderForcedDown(provider: "fnb" | "gaso"): boolean {
  const key = provider === "fnb" ? "force_fnb_down" : "force_gaso_down";
  return getSystemSetting(key) === "true";
}

export function isMaintenanceMode(): boolean {
  return getSystemSetting("maintenance_mode") === "true";
}

function markProviderBlocked(health: ProviderHealth, errorMsg: string) {
  const wasHealthy = health.status === "healthy";
  health.status = "blocked";
  health.lastError = errorMsg;
  health.blockedUntil = new Date(Date.now() + BLOCK_DURATION_MS);
  return wasHealthy; // Return true if this is first block (to trigger notification)
}

function markProviderHealthy(health: ProviderHealth) {
  const wasBlocked = health.status === "blocked";
  health.status = "healthy";
  health.lastError = null;
  health.blockedUntil = null;

  // Reset notification flag when PowerBI comes back online
  if (health === powerBIHealth && wasBlocked) {
    powerBIDownNotified = false;
  }
}

function isProviderAvailable(health: ProviderHealth): boolean {
  if (health.status === "healthy") return true;
  if (health.blockedUntil && new Date() > health.blockedUntil) {
    markProviderHealthy(health);
    return true;
  }
  return false;
}

export function getProvidersHealth() {
  return {
    fnb: {
      status: fnbHealth.status,
      available: isProviderAvailable(fnbHealth),
      lastError: fnbHealth.lastError,
      blockedUntil: fnbHealth.blockedUntil?.toISOString() || null,
    },
    gaso: {
      status: gasoHealth.status,
      available: isProviderAvailable(gasoHealth),
      lastError: gasoHealth.lastError,
      blockedUntil: gasoHealth.blockedUntil?.toISOString() || null,
    },
    powerbi: {
      status: powerBIHealth.status,
      available: isProviderAvailable(powerBIHealth),
      lastError: powerBIHealth.lastError,
      blockedUntil: powerBIHealth.blockedUntil?.toISOString() || null,
    },
  };
}

async function getFNBSession(): Promise<FNBSession> {
  if (fnbSession && fnbSession.expiresAt > new Date()) return fnbSession;

  const authUrl = `${process.env.CALIDDA_BASE_URL}/FNB_Services/api/Seguridad/autenticar`;

  const response = await fetch(authUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://appweb.calidda.com.pe",
      referer: "https://appweb.calidda.com.pe/WebFNB/login",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: JSON.stringify({
      usuario: process.env.CALIDDA_USERNAME,
      password: process.env.CALIDDA_PASSWORD,
      captcha: "exitoso",
      Latitud: "",
      Longitud: "",
    }),
  });

  console.log(
    `[Calidda] Auth response status: ${response.status} ${response.statusText}`,
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Calidda] Auth failed - Response body: ${errorText}`);
    const errorMsg = `FNB Auth HTTP ${response.status}`;
    markProviderBlocked(fnbHealth, errorMsg);
    throw new Error(errorMsg);
  }

  const data = (await response.json()) as FNBAuthResponse;

  if (!(data.valid && data.data?.authToken)) {
    const errorMsg = `FNB Auth Invalid: ${data.message || "No token"}`;

    // Check for blocked user
    if (data.message?.toLowerCase().includes("bloqueado")) {
      markProviderBlocked(fnbHealth, errorMsg);
    }

    throw new Error(errorMsg);
  }

  const decoded = jwt.decode(data.data.authToken) as JwtPayload | null;
  if (!decoded) {
    throw new Error("Failed to decode JWT token");
  }

  fnbSession = {
    token: data.data.authToken,
    allyId: decoded.commercialAllyId,
    expiresAt: new Date(Date.now() + 3500 * 1000),
  };

  markProviderHealthy(fnbHealth);
  return fnbSession;
}

export const FNBProvider = {
  async checkCredit(
    dni: string,
    phoneNumber?: string,
  ): Promise<ProviderCheckResult> {
    // Check if this is a simulation with a persona
    if (phoneNumber) {
      const conv = db
        .prepare(
          "SELECT is_simulation, persona_id FROM conversations WHERE phone_number = ?",
        )
        .get(phoneNumber) as
        | { is_simulation: number; persona_id: string | null }
        | undefined;

      if (conv?.is_simulation === 1 && conv.persona_id) {
        const persona = PersonasService.getById(conv.persona_id);
        if (persona) {
          console.log(`[FNB] Using test persona: ${persona.name}`);
          return PersonasService.toProviderResult(persona);
        }
      }
    }

    // Check if admin has forced provider down
    if (isProviderForcedDown("fnb")) {
      console.log(`[FNB] Provider forced down by admin for DNI ${dni}`);
      return {
        eligible: false,
        credit: 0,
        reason: "provider_forced_down",
      };
    }

    // Check if provider is blocked
    if (!isProviderAvailable(fnbHealth)) {
      console.log(
        `[FNB] Provider blocked, returning unavailable for DNI ${dni}`,
      );
      return {
        eligible: false,
        credit: 0,
        reason: "provider_unavailable",
      };
    }

    try {
      console.log(`[FNB] Checking credit for DNI ${dni}...`);
      const session = await getFNBSession();
      const params = new URLSearchParams({
        numeroDocumento: dni,
        tipoDocumento: "PE2",
        idAliado: session.allyId,
        canal: "FNB",
      });

      const url = `${process.env.CALIDDA_BASE_URL}/FNB_Services/api/financiamiento/lineaCredito?${params}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
          referer: "https://appweb.calidda.com.pe/WebFNB/consulta-credito",
        },
      });

      if (!res.ok) {
        console.error(`[FNB] Query failed with status ${res.status}`);
        throw new Error(`FNB Query Failed: ${res.status}`);
      }
      const data = (await res.json()) as FNBCreditResponse;

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
      return { eligible: false, credit: 0, reason: "api_error" };
    }
  },
};

const VISUAL_IDS = {
  estado: "1939653a9d6bbd4abe2b",
  saldo: "fa2a9da34ca3522cc3b6",
  nombre: "a75cdb19088461402488",
  nse: "3ad014bf316f57fe6b8f",
};

async function queryPowerBI(
  dni: string,
  propertyName: string,
  visualId: string,
) {
  const payload = {
    version: "1.0.0",
    queries: [
      {
        Query: {
          Commands: [
            {
              SemanticQueryDataShapeCommand: {
                Query: {
                  Version: 2,
                  From: [
                    {
                      Name: "m",
                      Entity: "Medidas",
                      Type: 0,
                    },
                    { Name: "b", Entity: "BD", Type: 0 },
                  ],
                  Select: [
                    {
                      Measure: {
                        Expression: {
                          SourceRef: { Source: "m" },
                        },
                        Property: propertyName,
                      },
                      Name: `Medidas.${propertyName}`,
                      NativeReferenceName: propertyName,
                    },
                  ],
                  Where: [
                    {
                      Condition: {
                        Contains: {
                          Left: {
                            Column: {
                              Expression: {
                                SourceRef: {
                                  Source: "b",
                                },
                              },
                              Property: "DNI",
                            },
                          },
                          Right: {
                            Literal: {
                              Value: `'${dni}'`,
                            },
                          },
                        },
                      },
                    },
                  ],
                },
                Binding: {
                  Primary: {
                    Groupings: [{ Projections: [0] }],
                  },
                  Version: 1,
                },
                ExecutionMetricsKind: 1,
              },
            },
          ],
        },
        QueryId: "",
        ApplicationContext: {
          DatasetId: process.env.POWERBI_DATASET_ID,
          Sources: [
            {
              ReportId: process.env.POWERBI_REPORT_ID,
              VisualId: visualId,
            },
          ],
        },
      },
    ],
    cancelQueries: [],
    modelId: parseInt(process.env.POWERBI_MODEL_ID || "0", 10),
  };

  const res = await fetch(
    "https://wabi-south-central-us-api.analysis.windows.net/public/reports/querydata?synchronous=true",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PowerBI-ResourceKey": process.env.POWERBI_RESOURCE_KEY!,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    console.error(
      `[PowerBI Error] ${res.status} ${res.statusText} - Property: ${propertyName}, DNI: ${dni}`,
    );
    console.error(`[PowerBI Error] Response: ${errorText}`);

    // Mark PowerBI as blocked on auth failures
    if (res.status === 401 || res.status === 403) {
      const errorMsg = `PowerBI Auth Failed: ${res.status} ${res.statusText}`;
      const wasHealthy = markProviderBlocked(powerBIHealth, errorMsg);
      if (wasHealthy) {
        console.error(`[PowerBI] BLOCKED for 30min - Reason: ${errorMsg}`);
      }
    }

    return undefined;
  }

  const data = (await res.json()) as PowerBIResponse;
  try {
    const val =
      data.results?.[0]?.result?.data?.dsr?.DS?.[0]?.PH?.[0]?.DM0?.[0]?.M0;
    if (val === undefined || val === null) return undefined;
    return String(val).trim();
  } catch {
    return undefined;
  }
}

export const GasoProvider = {
  async checkEligibility(
    dni: string,
    phoneNumber?: string,
  ): Promise<ProviderCheckResult> {
    // Check if this is a simulation with a persona
    if (phoneNumber) {
      const conv = db
        .prepare(
          "SELECT is_simulation, persona_id FROM conversations WHERE phone_number = ?",
        )
        .get(phoneNumber) as
        | { is_simulation: number; persona_id: string | null }
        | undefined;

      if (conv?.is_simulation === 1 && conv.persona_id) {
        const persona = PersonasService.getById(conv.persona_id);
        if (persona) {
          console.log(`[GASO] Using test persona: ${persona.name}`);
          return PersonasService.toProviderResult(persona);
        }
      }
    }

    // Check if admin has forced provider down
    if (isProviderForcedDown("gaso")) {
      console.log(`[GASO] Provider forced down by admin for DNI ${dni}`);
      return {
        eligible: false,
        credit: 0,
        reason: "provider_forced_down",
      };
    }

    // Check if provider is blocked
    if (!isProviderAvailable(gasoHealth)) {
      return {
        eligible: false,
        credit: 0,
        reason: "provider_unavailable",
      };
    }

    // If PowerBI is blocked, use Calidda FNB as fallback
    if (!isProviderAvailable(powerBIHealth)) {
      const shouldNotify = !powerBIDownNotified;
      powerBIDownNotified = true;

      console.log(
        `[GASO] PowerBI unavailable, using Calidda FNB as fallback for DNI ${dni}`,
      );

      // Check if Calidda is also blocked before attempting fallback
      if (!isProviderAvailable(fnbHealth)) {
        console.error(`[GASO] Both PowerBI and Calidda are unavailable!`);
        if (shouldNotify) {
          return {
            eligible: false,
            credit: 0,
            reason: "all_providers_down",
          };
        }
        return {
          eligible: false,
          credit: 0,
          reason: "provider_unavailable",
        };
      }

      try {
        const fnbResult = await FNBProvider.checkCredit(dni);
        // If Calidda returns data, use it as GASO eligibility
        if (fnbResult.eligible && fnbResult.credit > 0) {
          return {
            eligible: true,
            credit: fnbResult.credit,
            name: fnbResult.name,
            reason: shouldNotify ? "powerbi_down_first_detection" : undefined,
            nse: undefined, // NSE not available from Calidda
          };
        }
        // If not found in Calidda either, return not eligible
        return {
          eligible: false,
          credit: 0,
          reason: shouldNotify
            ? "powerbi_down_not_found"
            : "not_found_in_fallback",
          name: fnbResult.name,
        };
      } catch (error) {
        console.error("[GASO] Calidda fallback failed:", error);
        return {
          eligible: false,
          credit: 0,
          reason: shouldNotify
            ? "powerbi_down_fallback_error"
            : "fallback_error",
        };
      }
    }

    try {
      const [estado, nombre, saldoStr, nseStr] = await Promise.all([
        queryPowerBI(dni, "Estado", VISUAL_IDS.estado),
        queryPowerBI(dni, "Cliente", VISUAL_IDS.nombre),
        queryPowerBI(dni, "Saldo", VISUAL_IDS.saldo),
        queryPowerBI(dni, "NSE", VISUAL_IDS.nse),
      ]);

      // If ALL queries returned undefined, PowerBI is completely down - use fallback
      if (!estado && !nombre && !saldoStr && !nseStr) {
        console.log(
          `[GASO] PowerBI returned no data (all undefined), attempting Calidda fallback for DNI ${dni}`,
        );

        // Check if Calidda is available
        if (!isProviderAvailable(fnbHealth)) {
          console.error(`[GASO] Both PowerBI and Calidda are unavailable!`);
          return {
            eligible: false,
            credit: 0,
            reason: "all_providers_down",
          };
        }

        try {
          const fnbResult = await FNBProvider.checkCredit(dni);
          if (fnbResult.eligible && fnbResult.credit > 0) {
            return {
              eligible: true,
              credit: fnbResult.credit,
              name: fnbResult.name,
              reason: "powerbi_failed_used_fallback",
              nse: undefined,
            };
          }
          return {
            eligible: false,
            credit: 0,
            reason: "not_found_in_fallback",
            name: fnbResult.name,
          };
        } catch (error) {
          console.error("[GASO] Calidda fallback failed:", error);
          return {
            eligible: false,
            credit: 0,
            reason: "fallback_error",
          };
        }
      }

      // Check Estado field - primary eligibility gate
      if (!estado || estado === "--" || estado === "NO APLICA") {
        // Parse credit for context even if not eligible
        let credit = 0;
        if (
          saldoStr &&
          typeof saldoStr === "string" &&
          saldoStr !== "undefined"
        ) {
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

      // Estado is "APLICA FNB" or similar positive value - client is eligible
      let credit = 0;
      if (
        saldoStr &&
        typeof saldoStr === "string" &&
        saldoStr !== "undefined"
      ) {
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
        reason: undefined,
      };
    } catch (error) {
      console.error("[GASO Provider Error]", error);

      // Mark as blocked if it's a persistent auth/connection error
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (
          msg.includes("auth") ||
          msg.includes("401") ||
          msg.includes("403") ||
          msg.includes("bloqueado")
        ) {
          markProviderBlocked(gasoHealth, error.message);
          console.error(
            `[GASO Provider] BLOCKED for 30min - Reason: ${error.message}`,
          );
        }
      }

      return { eligible: false, credit: 0, reason: "api_error" };
    }
  },
};

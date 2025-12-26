import jwt from "jsonwebtoken";
import process from "node:process";
import type { ProviderCheckResult } from "@totem/types";

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

function markProviderBlocked(health: ProviderHealth, errorMsg: string) {
    health.status = "blocked";
    health.lastError = errorMsg;
    health.blockedUntil = new Date(Date.now() + BLOCK_DURATION_MS);
}

function markProviderHealthy(health: ProviderHealth) {
    health.status = "healthy";
    health.lastError = null;
    health.blockedUntil = null;
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
    };
}

async function getFNBSession(): Promise<FNBSession> {
    if (fnbSession && fnbSession.expiresAt > new Date()) return fnbSession;

    const response = await fetch(
        `${process.env.CALIDDA_BASE_URL}/FNB_Services/api/Seguridad/autenticar`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
                origin: "https://appweb.calidda.com.pe",
                referer: "https://appweb.calidda.com.pe/WebFNB/login",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify({
                usuario: process.env.CALIDDA_USERNAME,
                password: process.env.CALIDDA_PASSWORD,
                captcha: "exitoso",
                Latitud: "",
                Longitud: "",
            }),
        },
    );

    if (!response.ok) {
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
    async checkCredit(dni: string): Promise<ProviderCheckResult> {
        // Check if provider is blocked
        if (!isProviderAvailable(fnbHealth)) {
            return {
                eligible: false,
                credit: 0,
                reason: "provider_unavailable",
            };
        }

        try {
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
                    "referer": "https://appweb.calidda.com.pe/WebFNB/consulta-credito",
                },
            });

            if (!res.ok) throw new Error(`FNB Query Failed: ${res.status}`);
            const data = (await res.json()) as FNBCreditResponse;

            if (!(data.valid && data.data)) {
                return { eligible: false, credit: 0, name: undefined };
            }

            return {
                eligible: true,
                credit: parseFloat(data.data.lineaCredito || "0"),
                name: data.data.nombre,
            };
        } catch (_error) {
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

    if (!res.ok) return undefined;

    const data = (await res.json()) as PowerBIResponse;
    try {
        const val =
            data.results?.[0]?.result?.data?.dsr?.DS?.[0]?.PH?.[0]?.DM0?.[0]
                ?.M0;
        if (val === undefined || val === null) return undefined;
        return String(val).trim();
    } catch {
        return undefined;
    }
}

export const GasoProvider = {
    async checkEligibility(dni: string): Promise<ProviderCheckResult> {
        // Check if provider is blocked
        if (!isProviderAvailable(gasoHealth)) {
            return {
                eligible: false,
                credit: 0,
                reason: "provider_unavailable",
            };
        }

        try {
            const [estado, nombre, saldoStr, nseStr] = await Promise.all([
                queryPowerBI(dni, "Estado", VISUAL_IDS.estado),
                queryPowerBI(dni, "Cliente", VISUAL_IDS.nombre),
                queryPowerBI(dni, "Saldo", VISUAL_IDS.saldo),
                queryPowerBI(dni, "NSE", VISUAL_IDS.nse),
            ]);

            // Check Estado field - primary eligibility gate
            if (!estado || estado === "--" || estado === "NO APLICA") {
                // Parse credit for context even if not eligible
                let credit = 0;
                if (saldoStr && saldoStr !== "undefined") {
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
                    reason:
                        credit === 0
                            ? "no_credit_line"
                            : "not_eligible_per_calidda",
                    name: nombre,
                };
            }

            // Estado is "APLICA FNB" or similar positive value - client is eligible
            let credit = 0;
            if (saldoStr && saldoStr !== "undefined") {
                const clean = saldoStr
                    .replace("S/", "")
                    .trim()
                    .replace(/\./g, "")
                    .replace(",", ".");
                credit = parseFloat(clean) || 0;
            }

            const nse =
                nseStr && nseStr !== "undefined"
                    ? parseInt(nseStr, 10)
                    : undefined;

            return {
                eligible: true,
                credit,
                name: nombre,
                nse,
                reason: undefined,
            };
        } catch (error) {
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
                }
            }

            return { eligible: false, credit: 0, reason: "api_error" };
        }
    },
};

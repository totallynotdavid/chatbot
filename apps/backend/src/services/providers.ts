import jwt from 'jsonwebtoken';

type FNBSession = { token: string; allyId: string; expiresAt: Date };
let fnbSession: FNBSession | null = null;

async function getFNBSession(): Promise<FNBSession> {
    if (fnbSession && fnbSession.expiresAt > new Date()) return fnbSession;

    const response = await fetch(`${process.env.CALIDDA_BASE_URL}/FNB_Services/api/Seguridad/autenticar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            usuario: process.env.CALIDDA_USERNAME,
            password: process.env.CALIDDA_PASSWORD,
            captcha: "exitoso",
            Latitud: "",
            Longitud: ""
        })
    });

    if (!response.ok) throw new Error(`FNB Auth Failed: ${response.status}`);
    const data = await response.json();
    
    if (!data.valid || !data.data?.authToken) throw new Error(`FNB Auth Invalid: ${data.message}`);

    const decoded = jwt.decode(data.data.authToken) as any;
    
    fnbSession = {
        token: data.data.authToken,
        allyId: decoded.commercialAllyId,
        expiresAt: new Date(Date.now() + 3500 * 1000)
    };
    
    return fnbSession;
}

export const FNBProvider = {
    async checkCredit(dni: string) {
        try {
            const session = await getFNBSession();
            const params = new URLSearchParams({
                numeroDocumento: dni,
                tipoDocumento: "PE2",
                idAliado: session.allyId,
                canal: "FNB"
            });

            const url = `${process.env.CALIDDA_BASE_URL}/FNB_Services/api/financiamiento/lineaCredito?${params}`;
            const res = await fetch(url, {
                headers: { 
                    'Authorization': `Bearer ${session.token}`,
                    'Content-Type': 'application/json' 
                }
            });

            if (!res.ok) throw new Error(`FNB Query Failed: ${res.status}`);
            const data = await res.json();

            if (!data.valid || !data.data) {
                return { eligible: false, credit: 0, name: undefined };
            }

            return {
                eligible: true,
                credit: parseFloat(data.data.lineaCredito || 0),
                name: data.data.nombre
            };
        } catch (error) {
            console.error('FNB Provider Error:', error);
            return { eligible: false, credit: 0, reason: 'api_error' };
        }
    }
};

const VISUAL_IDS = {
    estado: "1939653a9d6bbd4abe2b",
    saldo: "fa2a9da34ca3522cc3b6",
    nombre: "a75cdb19088461402488",
    nse: "3ad014bf316f57fe6b8f",
    serviceCuts: "04df67600e7aad10d3a0",
    habilitado: "7f69ea308db71aa50aa7",
};

async function queryPowerBI(dni: string, propertyName: string, visualId: string) {
    const payload = {
        version: "1.0.0",
        queries: [{
            Query: {
                Commands: [{
                    SemanticQueryDataShapeCommand: {
                        Query: {
                            Version: 2,
                            From: [{ Name: "m", Entity: "Medidas", Type: 0 }, { Name: "b", Entity: "BD", Type: 0 }],
                            Select: [{
                                Measure: { Expression: { SourceRef: { Source: "m" } }, Property: propertyName },
                                Name: `Medidas.${propertyName}`,
                                NativeReferenceName: propertyName,
                            }],
                            Where: [{
                                Condition: {
                                    Contains: {
                                        Left: { Column: { Expression: { SourceRef: { Source: "b" } }, Property: "DNI" } },
                                        Right: { Literal: { Value: `'${dni}'` } },
                                    },
                                },
                            }],
                        },
                        Binding: { Primary: { Groupings: [{ Projections: [0] }] }, Version: 1 },
                        ExecutionMetricsKind: 1,
                    },
                }],
            },
            QueryId: "",
            ApplicationContext: {
                DatasetId: process.env.POWERBI_DATASET_ID,
                Sources: [{ ReportId: process.env.POWERBI_REPORT_ID, VisualId: visualId }],
            },
        }],
        cancelQueries: [],
        modelId: parseInt(process.env.POWERBI_MODEL_ID || "0", 10),
    };

    const res = await fetch("https://wabi-south-central-us-api.analysis.windows.net/public/reports/querydata?synchronous=true", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-PowerBI-ResourceKey": process.env.POWERBI_RESOURCE_KEY!,
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) return undefined;
    
    const data = await res.json();
    try {
        const val = data.results[0].result.data.dsr.DS[0].PH[0].DM0[0].M0;
        return String(val).trim();
    } catch {
        return undefined;
    }
}

export const GasoProvider = {
    async checkEligibility(dni: string) {
        try {
            const [estado, nombre, saldoStr, nseStr, serviceCutsStr, habilitadoStr] = await Promise.all([
                queryPowerBI(dni, "Estado", VISUAL_IDS.estado),
                queryPowerBI(dni, "Cliente", VISUAL_IDS.nombre),
                queryPowerBI(dni, "Saldo", VISUAL_IDS.saldo),
                queryPowerBI(dni, "NSE", VISUAL_IDS.nse),
                queryPowerBI(dni, "ServiceCuts", VISUAL_IDS.serviceCuts),
                queryPowerBI(dni, "Habilitado", VISUAL_IDS.habilitado),
            ]);

            if (!estado || estado === "--" || estado === "NO APLICA") {
                return { eligible: false, credit: 0, reason: 'not_found' };
            }

            let credit = 0;
            if (saldoStr) {
                const clean = saldoStr.replace("S/", "").trim().replace(/\./g, "").replace(",", ".");
                credit = parseFloat(clean);
            }

            const nse = nseStr ? parseInt(nseStr, 10) : undefined;
            const cuts = serviceCutsStr ? parseInt(serviceCutsStr, 10) : 0;
            const habilitado = habilitadoStr?.toUpperCase() === "SI";

            if (!habilitado) return { eligible: false, credit, reason: 'installation_pending', name: nombre };
            if (cuts > 1) return { eligible: false, credit, reason: 'service_cuts_exceeded', name: nombre };
            
            return {
                eligible: true,
                credit,
                name: nombre,
                nse,
                reason: undefined
            };

        } catch (error) {
            console.error('Gaso Provider Error:', error);
            return { eligible: false, credit: 0, reason: 'api_error' };
        }
    }
};

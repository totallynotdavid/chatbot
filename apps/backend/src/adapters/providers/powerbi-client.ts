import { config } from "../../config.ts";

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

const VISUAL_IDS = {
  estado: "1939653a9d6bbd4abe2b",
  saldo: "fa2a9da34ca3522cc3b6",
  nombre: "a75cdb19088461402488",
  nse: "3ad014bf316f57fe6b8f",
};

async function queryField(
  dni: string,
  propertyName: string,
  visualId: string,
): Promise<string | undefined> {
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
                    { Name: "m", Entity: "Medidas", Type: 0 },
                    { Name: "b", Entity: "BD", Type: 0 },
                  ],
                  Select: [
                    {
                      Measure: {
                        Expression: { SourceRef: { Source: "m" } },
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
                              Expression: { SourceRef: { Source: "b" } },
                              Property: "DNI",
                            },
                          },
                          Right: { Literal: { Value: `'${dni}'` } },
                        },
                      },
                    },
                  ],
                },
                Binding: {
                  Primary: { Groupings: [{ Projections: [0] }] },
                  Version: 1,
                },
                ExecutionMetricsKind: 1,
              },
            },
          ],
        },
        QueryId: "",
        ApplicationContext: {
          DatasetId: config.powerbi.datasetId,
          Sources: [
            {
              ReportId: config.powerbi.reportId,
              VisualId: visualId,
            },
          ],
        },
      },
    ],
    cancelQueries: [],
    modelId: parseInt(config.powerbi.modelId || "0", 10),
  };

  const res = await fetch(
    "https://wabi-south-central-us-api.analysis.windows.net/public/reports/querydata?synchronous=true",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PowerBI-ResourceKey": config.powerbi.resourceKey,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    throw new Error(`PowerBI Query Failed: ${res.status} ${res.statusText}`);
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

async function queryAll(dni: string) {
  const [estado, nombre, saldoStr, nseStr] = await Promise.all([
    queryField(dni, "Estado", VISUAL_IDS.estado),
    queryField(dni, "Cliente", VISUAL_IDS.nombre),
    queryField(dni, "Saldo", VISUAL_IDS.saldo),
    queryField(dni, "NSE", VISUAL_IDS.nse),
  ]);

  return { estado, nombre, saldoStr, nseStr };
}

export const PowerBIClient = {
  queryField,
  queryAll,
};

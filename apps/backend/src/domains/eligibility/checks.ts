import { checkFNB } from "./fnb.ts";
import { checkGASO } from "./gaso.ts";
import type { ProviderResult } from "./types.ts";

export type ProviderResults = {
  fnb: ProviderResult | null;
  powerbi: ProviderResult | null;
  errors: string[];
};

export async function runProviderChecks(
  dni: string,
  phoneNumber?: string,
): Promise<ProviderResults> {
  const results: ProviderResults = {
    fnb: null,
    powerbi: null,
    errors: [],
  };

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

  return results;
}

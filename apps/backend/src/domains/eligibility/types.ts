import type { ProviderCheckResult } from "@totem/types";

export type ProviderResult = {
  success: boolean;
  result?: ProviderCheckResult;
  error?: string;
};

export type EligibilityResult = ProviderCheckResult & {
  needsHuman?: boolean;
  handoffReason?: string;
  name?: string;
  nse?: number;
};

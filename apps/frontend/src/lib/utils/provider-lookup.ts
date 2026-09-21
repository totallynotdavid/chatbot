/**
 * The body of `GET /api/providers/:dni`. `result` is the eligibility mapper's
 * output (`mapper.ts` in the backend), or `{ error }` when the check failed.
 */
export type ProviderLookup = {
  dni: string;
  result: LookupResult;
  /** The providers whose circuit breaker was closed when the check ran. */
  providersChecked: string[];
};

export type LookupResult = {
  type?: "eligibility_result";
  status?: "eligible" | "not_eligible" | "system_outage" | "needs_human";
  segment?: "fnb" | "gaso";
  credit?: number;
  name?: string;
  nse?: number;
  error?: string;
};

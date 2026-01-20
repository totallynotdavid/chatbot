import { createEvent } from "../../../shared/events/index.ts";

export type ProviderDegradedEvent = ReturnType<typeof ProviderDegraded>;

export function ProviderDegraded(payload: {
  failedProvider: string;
  workingProvider: string;
  dni: string;
  errors: string[];
}) {
  return createEvent("eligibility.provider-degraded", payload);
}

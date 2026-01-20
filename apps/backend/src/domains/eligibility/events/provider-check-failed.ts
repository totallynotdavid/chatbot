import { createEvent } from "../../../shared/events/index.ts";

export type ProviderCheckFailedEvent = ReturnType<typeof ProviderCheckFailed>;

export function ProviderCheckFailed(payload: {
  provider: string;
  dni: string;
  reason: string;
  error: string;
}) {
  return createEvent("eligibility.provider-check-failed", payload);
}

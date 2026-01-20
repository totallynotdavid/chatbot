import { createEvent } from "../../../shared/events/index.ts";

export type SystemOutageDetectedEvent = ReturnType<typeof SystemOutageDetected>;

export function SystemOutageDetected(payload: {
  dni: string;
  errors: string[];
  timestamp: number;
}) {
  return createEvent("eligibility.system-outage-detected", payload);
}

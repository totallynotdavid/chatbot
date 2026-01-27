export type { DomainEvent } from "@totem/types";
import { createTraceId } from "@totem/utils";

export function createEvent<T extends string, P>(
  type: T,
  payload: P,
): { type: T; payload: P; timestamp: number; traceId: string } {
  return {
    type,
    payload,
    timestamp: Date.now(),
    traceId: createTraceId(),
  };
}

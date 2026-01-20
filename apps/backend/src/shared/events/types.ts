export interface DomainEvent {
  type: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export function createEvent<T extends string, P>(
  type: T,
  payload: P,
): DomainEvent & { type: T; payload: P } {
  return {
    type,
    payload,
    timestamp: Date.now(),
  };
}

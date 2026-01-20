import type { DomainEvent } from "./types.ts";

type EventHandler<E extends DomainEvent = DomainEvent> = (
  event: E,
) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on<E extends DomainEvent>(eventType: string, handler: EventHandler<E>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);
  }

  off<E extends DomainEvent>(
    eventType: string,
    handler: EventHandler<E>,
  ): void {
    this.handlers.get(eventType)?.delete(handler as EventHandler);
  }

  async emit(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;

    const promises = Array.from(handlers).map((handler) =>
      Promise.resolve(handler(event)),
    );

    await Promise.allSettled(promises);
  }

  // Get subscriber count for event type (useful for testing)
  subscriberCount(eventType: string): number {
    return this.handlers.get(eventType)?.size ?? 0;
  }

  //Clear all handlers (useful for testing)
  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();

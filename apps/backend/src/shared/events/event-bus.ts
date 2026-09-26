import type { Logger } from "@vendeya/logger";
import { createLogger } from "../../lib/logger.ts";
import type { DomainEvent } from "./types.ts";

type EventHandler<E extends DomainEvent = DomainEvent> = (
  event: E,
) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  constructor(private logger: Logger = createLogger("event-bus")) {}

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

  /**
   * Runs every handler of the event and resolves once all have settled. Never
   * rejects: an emitter is a side channel of its caller, and a handler that
   * fails is logged here rather than failing the request that emitted.
   */
  async emit(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;

    await Promise.all(
      Array.from(handlers).map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          this.logger.error(
            {
              error,
              eventType: event.type,
              traceId: event.traceId,
              tenantId: event.tenantId,
              channelAccountId: event.channelAccountId,
              handler: handler.name || "anonymous",
            },
            "Event handler failed",
          );
        }
      }),
    );
  }

  subscriberCount(eventType: string): number {
    return this.handlers.get(eventType)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();

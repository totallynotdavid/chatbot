import type { DomainEvent } from "./types.ts";
import type { EventBus } from "./event-bus.ts";

export class AsyncEventEmitter {
  constructor(private eventBus: EventBus) {}

  async emitCritical(event: DomainEvent): Promise<void> {
    await this.eventBus.emit(event);
  }

  emitAsync(event: DomainEvent): void {
    // The bus logs any handler failures, so emit failures won't break the caller.
    void Promise.resolve().then(() => this.eventBus.emit(event));
  }
}

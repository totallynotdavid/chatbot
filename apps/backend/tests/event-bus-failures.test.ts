/**
 * A listener that fails must not be invisible, and must not fail the code that
 * emitted the event. Callers such as the conversation turn and the webhook
 * `await` or fire `eventBus.emit` and have no handler of their own for it.
 */

import { describe, expect, it } from "bun:test";
import type { Logger } from "@vendeya/logger";
import { EventBus, createEvent } from "../src/shared/events/index.ts";

type LogCall = { fields: Record<string, unknown>; message: string };

function capturingLogger(): { logger: Logger; errors: LogCall[] } {
  const errors: LogCall[] = [];
  const logger = {
    error: (fields: Record<string, unknown>, message: string) => {
      errors.push({ fields, message });
    },
  } as unknown as Logger;
  return { logger, errors };
}

const event = createEvent(
  "order_created",
  { orderId: "o-1" },
  { traceId: "trace-1", tenantId: "tenant-1", channelAccountId: "acct-1" },
);

describe("EventBus listener failures", () => {
  it("logs a listener that rejects, with the event's context", async () => {
    const { logger, errors } = capturingLogger();
    const bus = new EventBus(logger);
    bus.on("order_created", async function failingListener() {
      throw new Error("dispatch exploded");
    });

    await bus.emit(event as never);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.fields).toMatchObject({
      eventType: "order_created",
      traceId: "trace-1",
      tenantId: "tenant-1",
      channelAccountId: "acct-1",
      handler: "failingListener",
    });
    expect((errors[0]!.fields.error as Error).message).toBe(
      "dispatch exploded",
    );
  });

  it("does not reject the emit when a listener throws synchronously", async () => {
    const { logger, errors } = capturingLogger();
    const bus = new EventBus(logger);
    bus.on("order_created", () => {
      throw new Error("sync boom");
    });

    await expect(bus.emit(event as never)).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect((errors[0]!.fields.error as Error).message).toBe("sync boom");
  });

  it("still runs the other listeners of the event", async () => {
    const { logger } = capturingLogger();
    const bus = new EventBus(logger);
    const ran: string[] = [];
    bus.on("order_created", () => {
      throw new Error("first fails");
    });
    bus.on("order_created", async () => {
      ran.push("second");
    });

    await bus.emit(event as never);

    expect(ran).toEqual(["second"]);
  });
});

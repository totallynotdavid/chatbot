import { eventBus } from "../shared/events/index.ts";
import { AsyncEventEmitter } from "../shared/events/async-emitter.ts";
import type { DomainEvent } from "@totem/types";
import { evaluateNotifications } from "../domains/notifications/evaluator.ts";
import { notificationRules } from "../domains/notifications/config.ts";
import { dispatchNotifications } from "../domains/notifications/dispatcher.ts";

import { createOrder } from "../domains/orders/write.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("event-bus");

function subscribe<E extends DomainEvent>(
  eventType: string,
  handler: (event: E) => void | Promise<void>,
): void {
  eventBus.on<E>(eventType, handler);
}

export const asyncEmitter = new AsyncEventEmitter(eventBus);

export function setupEventSubscribers(): void {
  const notificationEvents: DomainEvent["type"][] = [
    "agent_assigned",
    "enrichment_limit_exceeded",
    "order_created",
    "escalation_triggered",
    "system_error_occurred",
    "attention_required",
    "system_outage_detected",
    "provider_degraded",
  ];

  subscribe(
    "purchase_confirmed",
    async (event: DomainEvent & { type: "purchase_confirmed" }) => {
      if (!event.tenantId || !event.channelAccountId) {
        // Without the conversation's identity there is no tenant to file the
        // order under; dropping it is safer than guessing one.
        logger.error(
          { traceId: event.traceId, phoneNumber: event.payload.phoneNumber },
          "purchase_confirmed carried no tenant; order not created",
        );
        return;
      }

      createOrder({
        ref: {
          tenantId: event.tenantId,
          channelAccountId: event.channelAccountId,
          phoneNumber: event.payload.phoneNumber,
        },
        clientName: event.payload.clientName,
        clientDni: event.payload.dni,
        products: [
          {
            productId: event.payload.productId,
            name: event.payload.productName,
            quantity: 1,
            price: event.payload.amount,
          },
        ],
        totalAmount: event.payload.amount,
        deliveryAddress: "Pendiente de coordinación",
      });
    },
  );

  notificationEvents.forEach((eventType) => {
    subscribe(eventType, async (event: DomainEvent) => {
      const decisions = evaluateNotifications(event, notificationRules);
      await dispatchNotifications(decisions, event);
    });
  });
}

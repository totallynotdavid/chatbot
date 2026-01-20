import { eventBus } from "../shared/events/index.ts";
import { DevAlertSubscriber } from "../domains/notifications/subscribers/dev-alert-subscriber.ts";
import { AgentAlertSubscriber } from "../domains/notifications/subscribers/agent-alert-subscriber.ts";
import type {
  SystemOutageDetectedEvent,
  ProviderDegradedEvent,
} from "../domains/eligibility/events/index.ts";
import type { DomainEvent } from "../shared/events/types.ts";

function subscribe<E extends DomainEvent>(
  eventType: string,
  handler: (event: E) => void | Promise<void>,
): void {
  eventBus.on<E>(eventType, handler);
}

export function setupEventSubscribers(): void {
  const devAlerts = new DevAlertSubscriber();
  const agentAlerts = new AgentAlertSubscriber();

  // System outage events
  subscribe<SystemOutageDetectedEvent>(
    "eligibility.system-outage-detected",
    (event) => devAlerts.onSystemOutage(event),
  );
  subscribe<SystemOutageDetectedEvent>(
    "eligibility.system-outage-detected",
    (event) => agentAlerts.onSystemOutage(event),
  );

  // Provider degraded events
  subscribe<ProviderDegradedEvent>("eligibility.provider-degraded", (event) =>
    devAlerts.onProviderDegraded(event),
  );
}

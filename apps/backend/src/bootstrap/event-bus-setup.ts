import { eventBus } from "../shared/events/index.ts";
import { DevAlertSubscriber } from "../domains/notifications/subscribers/dev-alert-subscriber.ts";
import { AgentAlertSubscriber } from "../domains/notifications/subscribers/agent-alert-subscriber.ts";

export function setupEventSubscribers(): void {
  const devAlerts = new DevAlertSubscriber();
  const agentAlerts = new AgentAlertSubscriber();

  // System outage events
  eventBus.on("eligibility.system-outage-detected", (event) =>
    devAlerts.onSystemOutage(event as any),
  );
  eventBus.on("eligibility.system-outage-detected", (event) =>
    agentAlerts.onSystemOutage(event as any),
  );

  // Provider degraded events
  eventBus.on("eligibility.provider-degraded", (event) =>
    devAlerts.onProviderDegraded(event as any),
  );
}

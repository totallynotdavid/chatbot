import type { DomainEvent } from "@totem/types";
import { NotificationService } from "../service.ts";
import { createLogger } from "../../../lib/logger.ts";

const logger = createLogger("dev-alerts");

/**
 * Subscribes to eligibility events and sends dev notifications
 */
export class DevAlertSubscriber {
  async onSystemOutage(
    event: DomainEvent & { type: "system_outage_detected" },
  ): Promise<void> {
    await NotificationService.notifySystemOutage(
      "dev",
      {
        phoneNumber: "N/A",
        dni: event.payload.dni,
      },
      event.payload.errors,
    );
    logger.info({ dni: event.payload.dni }, "System outage alert sent to dev");
  }

  /**
   * Handle degraded service (WARNING)
   */
  async onProviderDegraded(
    event: DomainEvent & { type: "provider_degraded" },
  ): Promise<void> {
    const { failedProvider, workingProvider, dni, errors } = event.payload;

    await NotificationService.notifyDegradation(
      {
        phoneNumber: "N/A",
        dni,
      },
      `${failedProvider} caído, usando ${workingProvider}\nError: ${errors.join(", ")}`,
    );
    logger.warn(
      { failedProvider, workingProvider },
      "Degraded service alert sent",
    );
  }
}

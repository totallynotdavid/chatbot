import type { SystemOutageDetectedEvent } from "../../eligibility/events/index.ts";
import type { ProviderDegradedEvent } from "../../eligibility/events/index.ts";
import { NotificationService } from "../service.ts";
import { createLogger } from "../../../lib/logger.ts";

const logger = createLogger("dev-alerts");

/**
 * Subscribes to eligibility events and sends dev notifications
 */
export class DevAlertSubscriber {
  async onSystemOutage(event: SystemOutageDetectedEvent): Promise<void> {
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
  async onProviderDegraded(event: ProviderDegradedEvent): Promise<void> {
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

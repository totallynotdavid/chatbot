import type { SystemOutageDetectedEvent } from "../../eligibility/events/index.ts";
import type { ProviderDegradedEvent } from "../../eligibility/events/index.ts";
import { notifyTeam } from "../../../adapters/notifier/client.ts";
import { createLogger } from "../../../lib/logger.ts";

const logger = createLogger("dev-alerts");

/**
 * Subscribes to eligibility events and sends dev notifications
 */
export class DevAlertSubscriber {
  async onSystemOutage(event: SystemOutageDetectedEvent): Promise<void> {
    const message = [
      "🚨 URGENTE: Caída total de proveedores de elegibilidad",
      `DNI afectado: ${event.payload.dni}`,
      `Errores:`,
      ...event.payload.errors.map((e) => `  - ${e}`),
      `Revisar dashboard inmediatamente.`,
    ].join("\n");

    try {
      await notifyTeam("dev", message);
      logger.info(
        { dni: event.payload.dni },
        "System outage alert sent to dev",
      );
    } catch (error) {
      logger.error({ error }, "Failed to send system outage alert");
    }
  }

  /**
   * Handle degraded service (WARNING)
   */
  async onProviderDegraded(event: ProviderDegradedEvent): Promise<void> {
    const { failedProvider, workingProvider, dni, errors } = event.payload;

    const message = [
      `⚠️ Servicio degradado`,
      `${failedProvider} caído, usando ${workingProvider}`,
      `DNI: ${dni}`,
      `Error: ${errors.join(", ")}`,
    ].join("\n");

    try {
      await notifyTeam("dev", message);
      logger.warn(
        { failedProvider, workingProvider },
        "Degraded service alert sent",
      );
    } catch (error) {
      logger.error({ error }, "Failed to send degraded service alert");
    }
  }
}

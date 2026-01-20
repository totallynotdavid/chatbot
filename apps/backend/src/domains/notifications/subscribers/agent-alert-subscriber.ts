import type { SystemOutageDetectedEvent } from "../../eligibility/events/index.ts";
import { notifyTeam } from "../../../adapters/notifier/client.ts";
import { createLogger } from "../../../lib/logger.ts";

const logger = createLogger("agent-alerts");

/**
 * Subscribes to eligibility events and sends agent notifications
 */
export class AgentAlertSubscriber {
  async onSystemOutage(event: SystemOutageDetectedEvent): Promise<void> {
    const message = [
      "Sistema de verificación temporalmente no disponible.",
      `El cliente con DNI ${event.payload.dni} fue puesto en espera.`,
      "Se reintentará automáticamente cuando el sistema se recupere.",
    ].join("\n");

    try {
      await notifyTeam("agent", message);
      logger.info(
        { dni: event.payload.dni },
        "System outage alert sent to agents",
      );
    } catch (error) {
      logger.error({ error }, "Failed to send agent alert");
    }
  }
}

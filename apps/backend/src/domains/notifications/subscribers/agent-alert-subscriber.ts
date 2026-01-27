import type { DomainEvent } from "@totem/types";
import { NotificationService } from "../service.ts";
import { createLogger } from "../../../lib/logger.ts";

const logger = createLogger("agent-alerts");

/**
 * Subscribes to eligibility events and sends agent notifications
 */
export class AgentAlertSubscriber {
  async onSystemOutage(
    event: DomainEvent & { type: "system_outage_detected" },
  ): Promise<void> {
    await NotificationService.notifySystemOutage(
      "agent",
      {
        phoneNumber: "N/A",
        dni: event.payload.dni,
      },
      [
        "Sistema de verificación temporalmente no disponible.",
        `El cliente con DNI ${event.payload.dni} fue puesto en espera.`,
        "Se reintentará automáticamente cuando el sistema se recupere.",
      ],
    );
    logger.info(
      { dni: event.payload.dni },
      "System outage alert sent to agents",
    );
  }
}

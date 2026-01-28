import { db } from "../../db/index.ts";
import { createLogger } from "../../lib/logger.ts";
import type { DomainEvent } from "@totem/types";

const logger = createLogger("notification-resolver");

const STATIC_ROLES: Record<string, string | undefined> = {
  dev: process.env.WHATSAPP_GROUP_DEV,
  sales: process.env.WHATSAPP_GROUP_AGENT,
};

export const NotificationResolver = {
  async resolve(
    target: string,
    event: DomainEvent,
  ): Promise<string | undefined> {
    // If it looks like a phone number, return it directly.
    if (/^\+?\d+$/.test(target) || target.includes("@g.us")) {
      return target;
    }

    if (target in STATIC_ROLES) {
      const number = STATIC_ROLES[target];
      if (!number) {
        logger.warn(
          { role: target },
          "Role configured but no number found in environment",
        );
      }
      return number;
    }

    if (target === "agent") {
      const assigned = resolveAssignedAgent(event);
      return assigned || STATIC_ROLES.sales;
    }

    logger.warn(
      { target, eventType: event.type },
      "Unknown notification target",
    );
    return undefined;
  },
};

function resolveAssignedAgent(event: DomainEvent): string | undefined {
  if (
    "phoneNumber" in event.payload &&
    typeof event.payload.phoneNumber === "string"
  ) {
    const customerPhone = event.payload.phoneNumber;

    const result = db
      .prepare(`
      SELECT u.phone_number 
      FROM conversations c
      JOIN users u ON c.assigned_agent = u.id
      WHERE c.phone_number = ?
    `)
      .get(customerPhone) as { phone_number: string } | undefined;

    return result?.phone_number;
  }

  logger.warn(
    { eventType: event.type },
    "Cannot resolve agent: Event payload missing phoneNumber",
  );
  return undefined;
}

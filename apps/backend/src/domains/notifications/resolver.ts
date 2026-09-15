import { getOne } from "../../db/query.ts";
import { createLogger } from "../../lib/logger.ts";
import { TenantSettings } from "../settings/system.ts";
import type { DomainEvent } from "@totem/types";

const logger = createLogger("notification-resolver");

/**
 * Group numbers configured for the deployment. These are VendeYa's own
 * operations groups; a tenant that wants its own routing sets
 * `whatsapp_group_dev` / `whatsapp_group_sales` in its tenant settings.
 */
const STATIC_ROLES: Record<string, string | undefined> = {
  dev: process.env.WHATSAPP_GROUP_DEV,
  sales: process.env.WHATSAPP_GROUP_AGENT,
};

const TENANT_ROLE_KEYS: Record<string, string> = {
  dev: "whatsapp_group_dev",
  sales: "whatsapp_group_sales",
};

function staticTarget(target: string, tenantId?: string): string | undefined {
  if (tenantId && TENANT_ROLE_KEYS[target]) {
    const configured = TenantSettings.get(tenantId, TENANT_ROLE_KEYS[target]!);
    if (configured) return configured;
  }
  return STATIC_ROLES[target];
}

export const NotificationResolver = {
  async resolve(
    target: string,
    event: DomainEvent,
  ): Promise<string | undefined> {
    // If it looks like a phone number, return it directly.
    if (/^\+?\d+$/.test(target) || target.includes("@g.us")) {
      return target;
    }

    if (target in STATIC_ROLES || target in TENANT_ROLE_KEYS) {
      const number = staticTarget(target, event.tenantId);
      if (!number) {
        logger.warn(
          { role: target, tenantId: event.tenantId },
          "Role configured but no number found for tenant or environment",
        );
      }
      return number;
    }

    if (target === "agent") {
      const assigned = resolveAssignedAgent(event);
      return assigned || staticTarget("sales", event.tenantId);
    }

    logger.warn(
      { target, eventType: event.type },
      "Unknown notification target",
    );
    return undefined;
  },
};

/**
 * The agent assigned to the conversation the event came from.
 *
 * The conversation is named in full - tenant, channel account, contact number.
 * The channel account was optional here, which meant an event that arrived
 * without one was answered with whichever thread of that contact came first,
 * and so possibly with the agent handling the tenant's *other* number. Every
 * event raised from a conversation carries it; one that does not falls back to
 * the sales group rather than guessing a person.
 */
function resolveAssignedAgent(event: DomainEvent): string | undefined {
  if (
    "phoneNumber" in event.payload &&
    typeof event.payload.phoneNumber === "string"
  ) {
    const customerPhone = event.payload.phoneNumber;

    if (!event.tenantId || !event.channelAccountId) {
      logger.warn(
        {
          eventType: event.type,
          tenantId: event.tenantId,
          channelAccountId: event.channelAccountId,
        },
        "Cannot resolve agent: event does not name the conversation",
      );
      return undefined;
    }

    const result = getOne<{ phone_number: string }>(
      `SELECT u.phone_number
       FROM conversations c
       JOIN users u ON c.assigned_agent = u.id
       WHERE c.tenant_id = ? AND c.channel_account_id = ? AND c.phone_number = ?`,
      [event.tenantId, event.channelAccountId, customerPhone],
    );

    return result?.phone_number;
  }

  logger.warn(
    { eventType: event.type },
    "Cannot resolve agent: Event payload missing phoneNumber",
  );
  return undefined;
}

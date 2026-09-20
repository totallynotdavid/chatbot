import { db } from "../../db/index.ts";
import { createLogger } from "../../lib/logger.ts";
import { WhatsAppService } from "../../adapters/whatsapp/index.ts";
import { ChannelAccountService } from "../channels/accounts.ts";
import { NotificationResolver } from "./resolver.ts";
import type { NotificationDecision } from "./evaluator.ts";
import type { ChannelAccount, DomainEvent } from "@totem/types";

const logger = createLogger("notification-dispatcher");

interface NotificationChannelAdapter {
  /** Whether the message actually went out. */
  send(
    account: ChannelAccount,
    target: string,
    content: string,
  ): Promise<boolean>;
}

const whatsAppAdapter: NotificationChannelAdapter = {
  async send(account: ChannelAccount, target: string, content: string) {
    if (!target) return false;
    return WhatsAppService.sendDirect(account, target, content);
  },
};

const adapters: Record<string, NotificationChannelAdapter> = {
  whatsapp: whatsAppAdapter,
};

/**
 * Picks the account a notification goes out on. The event's own channel account
 * wins, then its tenant's default account, then the platform operations account.
 */
export function accountForEvent(event: DomainEvent): ChannelAccount | null {
  if (event.channelAccountId) {
    const account = ChannelAccountService.getById(event.channelAccountId);
    if (account) return account;
  }

  if (event.tenantId) {
    const account = ChannelAccountService.getDefaultForTenant(event.tenantId);
    if (account) return account;
  }

  // A platform-wide alert, such as both eligibility providers being down, has
  // no tenant, and `notification_traces.tenant_id` is nullable for that case.
  // Any event that found no account above takes this fallback, a tenant's own
  // event included.
  return ChannelAccountService.getPlatformOps();
}

export async function dispatchNotifications(
  decisions: NotificationDecision[],
  event: DomainEvent,
): Promise<void> {
  const now = Date.now();

  for (const decision of decisions) {
    const traceId = event.traceId;
    const ruleId = decision.ruleId;

    try {
      db.prepare(
        `INSERT INTO notification_traces
         (id, tenant_id, trace_id, event_type, rule_id, status, reason, content_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        event.tenantId ?? null,
        traceId,
        event.type,
        ruleId,
        decision.status,
        decision.status === "skipped" || decision.status === "failed"
          ? decision.reason
          : null,
        decision.status === "sent" ? decision.content : null,
        now,
      );
    } catch (error) {
      logger.error({ error, traceId }, "Failed to log notification trace");
    }

    if (decision.status === "sent") {
      try {
        const resolvedTarget = await NotificationResolver.resolve(
          decision.target,
          event,
        );

        if (!resolvedTarget) {
          logger.error(
            { target: decision.target, ruleId },
            "Resolution failed: Unknown recipient target",
          );

          markFailed(traceId, ruleId, "recipient_resolution_failed");
          continue;
        }

        const account = accountForEvent(event);
        if (!account) {
          logger.error(
            { ruleId, tenantId: event.tenantId, eventType: event.type },
            event.tenantId
              ? "No channel account available to send notification from"
              : "Platform-wide alert has nowhere to go: set platform_ops_channel_account_id or PLATFORM_OPS_PHONE_NUMBER_ID",
          );

          markFailed(traceId, ruleId, "no_channel_account");
          continue;
        }

        const adapter = adapters[decision.channel];
        if (!adapter) {
          logger.warn(
            { channel: decision.channel },
            "Channel not implemented yet",
          );
          markFailed(traceId, ruleId, "channel_not_implemented");
          continue;
        }

        // The Cloud adapter answers false, without throwing, when the account
        // is not active. A false answer must mark the trace failed.
        const sent = await adapter.send(
          account,
          resolvedTarget,
          decision.content,
        );

        if (!sent) {
          logger.error(
            {
              ruleId,
              traceId,
              channelAccountId: account.id,
              channelAccountStatus: account.status,
            },
            "Notification was not delivered",
          );

          markFailed(traceId, ruleId, "send_failed");
        }
      } catch (error: any) {
        logger.error(
          { error, traceId, ruleId },
          "Failed to dispatch notification",
        );

        markFailed(traceId, ruleId, error?.message ?? "unknown_error");
      }
    }
  }
}

function markFailed(traceId: string, ruleId: string, reason: string): void {
  try {
    db.prepare(
      `UPDATE notification_traces
       SET status = 'failed', reason = ?
       WHERE trace_id = ? AND rule_id = ?`,
    ).run(reason, traceId, ruleId);
  } catch {
    // Trace bookkeeping is best-effort. The delivery failure is already logged.
  }
}

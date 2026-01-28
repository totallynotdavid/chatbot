import { db } from "../../db/index.ts";
import { createLogger } from "../../lib/logger.ts";
import { WhatsAppService } from "../../adapters/whatsapp/index.ts";
import { NotificationResolver } from "./resolver.ts";
import type { NotificationDecision } from "./evaluator.ts";
import type { DomainEvent } from "@totem/types";

const logger = createLogger("notification-dispatcher");

interface NotificationChannelAdapter {
  send(target: string, content: string): Promise<void>;
}

const whatsAppAdapter: NotificationChannelAdapter = {
  async send(target: string, content: string) {
    if (!target) return;
    await WhatsAppService.sendMessage(target, content);
  },
};

const adapters: Record<string, NotificationChannelAdapter> = {
  whatsapp: whatsAppAdapter,
};

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
         (id, trace_id, event_type, rule_id, status, reason, content_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
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

          db.prepare(
            `UPDATE notification_traces 
             SET status = 'failed', reason = ? 
             WHERE trace_id = ? AND rule_id = ?`,
          ).run("recipient_resolution_failed", traceId, ruleId);

          continue;
        }

        const adapter = adapters[decision.channel];
        if (adapter) {
          await adapter.send(resolvedTarget, decision.content);
        } else {
          logger.warn(
            { channel: decision.channel },
            "Channel not implemented yet",
          );
        }
      } catch (error: any) {
        logger.error(
          { error, traceId, ruleId },
          "Failed to dispatch notification",
        );

        try {
          db.prepare(
            `UPDATE notification_traces 
                 SET status = 'failed', reason = ? 
                 WHERE trace_id = ? AND rule_id = ?`,
          ).run(error.message, traceId, ruleId);
        } catch (updateError) {
          // Ignore
        }
      }
    }
  }
}

import type { DomainEvent } from "@totem/types";
import type { NotificationRule } from "./config.ts";

export type NotificationDecision =
  | {
      status: "sent";
      content: string;
      target: string;
      ruleId: string;
      channel: string;
    }
  | {
      status: "skipped";
      reason: string;
      ruleId: string;
      content_snapshot?: string;
    }
  | {
      status: "failed";
      reason: string;
      ruleId: string;
    };

export function evaluateNotifications(
  event: DomainEvent,
  rules: NotificationRule[],
): NotificationDecision[] {
  const decisions: NotificationDecision[] = [];

  for (const rule of rules) {
    if (rule.triggerEvent !== event.type) continue;

    try {
      if (!rule.condition(event)) {
        decisions.push({
          status: "skipped",
          reason: "condition_false",
          ruleId: rule.id,
        });
        continue;
      }

      const content = rule.template(event);
      let target = rule.target;

      if (target === "dynamic_agent" && event.type === "agent_assigned") {
        if (!event.payload.agentPhone) {
          decisions.push({
            status: "skipped",
            reason: "missing_target_phone",
            ruleId: rule.id,
          });
          continue;
        }
        target = event.payload.agentPhone;
      }

      decisions.push({
        status: "sent",
        content,
        target,
        ruleId: rule.id,
        channel: rule.channel,
      });
    } catch (error: any) {
      decisions.push({
        status: "failed",
        reason: error.message || "template_error",
        ruleId: rule.id,
      });
    }
  }

  return decisions;
}

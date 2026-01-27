import { describe, it, expect } from "bun:test";
import { evaluateNotifications } from "./evaluator.ts";
import type { NotificationRule } from "./config.ts";

describe("Notification Evaluator", () => {
  const rules: NotificationRule[] = [
    {
      id: "agent_assignment_whatsapp",
      triggerEvent: "agent_assigned",
      channel: "whatsapp",
      target: "dynamic_agent",
      condition: (event) => {
        if (event.type !== "agent_assigned") return false;
        return !!event.payload.agentPhone;
      },
      template: (event) => {
        if (event.type !== "agent_assigned") return "";
        return `Assigned to ${event.payload.clientName}`;
      },
    },
  ];

  it("should generate a sent decision for valid assignment", () => {
    const event = {
      type: "agent_assigned" as const,
      traceId: "test-trace-1",
      timestamp: 123456789,
      payload: {
        phoneNumber: "51999999999",
        agentId: "agent-1",
        agentPhone: "51888888888",
        clientName: "Juan Perez",
      },
    };

    const decisions = evaluateNotifications(event, rules);

    expect(decisions).toMatchSnapshot();
  });

  it("should skip if condition is false", () => {
    const strictRules: NotificationRule[] = rules.map((r) => ({ ...r }));
    const firstRule = strictRules[0];
    if (!firstRule) throw new Error("Rule not found");

    firstRule.condition = () => false;

    const event = {
      type: "agent_assigned" as const,
      traceId: "test-trace-2",
      timestamp: 123456789,
      payload: {
        phoneNumber: "51999999999",
        agentId: "agent-1",
        agentPhone: "51888888888",
        clientName: "Juan Perez",
      },
    };

    const decisions = evaluateNotifications(event, strictRules);

    expect(decisions).toMatchSnapshot();
  });
});

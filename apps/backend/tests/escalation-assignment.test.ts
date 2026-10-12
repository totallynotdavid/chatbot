/**
 * A conversation that escalates is handed to an agent, and the agent hears
 * about it once. Each test runs the real bot turn; the only fake is the network.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationPhase } from "@vendeya/core";
import type { DomainEvent } from "@vendeya/types";

import { db } from "../src/db/index.ts";
import { handleMessage } from "../src/conversation/handler/index.ts";
import { checkAndReassignTimeouts } from "../src/domains/conversations/assignment.ts";
import { eventBus } from "../src/shared/events/index.ts";
import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

const CUSTOMER = "51900888001";

const SECOND_OBJECTION: ConversationPhase = {
  phase: "handling_objection",
  segment: "fnb",
  credit: 3000,
  name: "Ana",
  objectionCount: 2,
};

describe("escalating a conversation", () => {
  let tenant: TenantFixture;
  let alerts: Array<{ event: DomainEvent; assignedAtEmit: string | null }>;
  let assignments: DomainEvent[];
  let originalFetch: typeof globalThis.fetch;

  const ref = () => tenant.ref(CUSTOMER);

  function conversation() {
    const row = db
      .prepare(
        `SELECT assigned_agent, assignment_notified_at, status, handover_reason, context_data
         FROM conversations WHERE tenant_id = ? AND phone_number = ?`,
      )
      .get(tenant.tenantId, CUSTOMER) as {
      assigned_agent: string | null;
      assignment_notified_at: number | null;
      status: string;
      handover_reason: string | null;
      context_data: string;
    };
    return {
      assignedAgent: row.assigned_agent,
      notifiedAt: row.assignment_notified_at,
      status: row.status,
      handoverReason: row.handover_reason,
      phase: JSON.parse(row.context_data).phase as ConversationPhase,
    };
  }

  function agentWithPhone(phone: string): string {
    const { userId } = createMember(tenant, "sales_agent");
    db.prepare("UPDATE users SET phone_number = ? WHERE id = ?").run(
      phone,
      userId,
    );
    return userId;
  }

  async function customerWrites(text: string): Promise<void> {
    await handleMessage({
      ref: ref(),
      content: text,
      timestamp: Date.now() - 11 * 60 * 1000,
      messageId: `wamid-${crypto.randomUUID()}`,
    });
    // `handleMessage` does not await its own emit.
    await Bun.sleep(10);
  }

  const onAlert = (event: DomainEvent) => {
    if (event.tenantId !== tenant.tenantId) return;
    alerts.push({ event, assignedAtEmit: conversation().assignedAgent });
  };
  const onAssigned = (event: DomainEvent) => {
    if (event.tenantId === tenant.tenantId) assignments.push(event);
  };

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("escalation-assignment");
    insertConversation(ref(), {
      contextData: {
        phase: SECOND_OBJECTION,
        metadata: { createdAt: Date.now(), lastActivityAt: Date.now() },
      },
      isSimulation: true,
    });
    alerts = [];
    assignments = [];
    eventBus.on("escalation_triggered", onAlert);
    eventBus.on("agent_assigned", onAssigned);
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("{}")) as unknown as typeof fetch;
  });

  afterEach(() => {
    eventBus.off("escalation_triggered", onAlert);
    eventBus.off("agent_assigned", onAssigned);
    globalThis.fetch = originalFetch;
    dropTenantFixture(tenant);
  });

  it("assigns an available agent and silences the bot for them", async () => {
    const agent = agentWithPhone("51911111111");

    await customerWrites("no");

    expect(conversation()).toMatchObject({
      assignedAgent: agent,
      status: "human_takeover",
      handoverReason: "multiple_objections",
      phase: { phase: "escalated", reason: "multiple_objections" },
    });
    expect(conversation().notifiedAt).toBeGreaterThan(0);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      payload: { agentId: agent, agentPhone: "51911111111" },
    });
  });

  it("assigns before it alerts, so the alert reaches the agent", async () => {
    const agent = agentWithPhone("51911111111");

    await customerWrites("no");

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.assignedAtEmit).toBe(agent);
  });

  it("leaves the conversation to the sales group when nobody is available", async () => {
    const agent = agentWithPhone("51911111111");
    db.prepare(
      "UPDATE tenant_memberships SET is_available = 0 WHERE user_id = ?",
    ).run(agent);

    await customerWrites("no");

    expect(conversation()).toMatchObject({
      assignedAgent: null,
      notifiedAt: null,
      status: "human_takeover",
      phase: { phase: "escalated" },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.assignedAtEmit).toBeNull();
    expect(assignments).toEqual([]);
  });

  describe("when the customer keeps writing", () => {
    it("alerts and assigns once, and keeps the agent and the time", async () => {
      const agents = [
        agentWithPhone("51911111111"),
        agentWithPhone("51922222222"),
      ];
      await customerWrites("no");
      const afterEscalation = conversation();
      expect(agents).toContain(afterEscalation.assignedAgent!);

      await customerWrites("hola?");
      await customerWrites("¿alguien me atiende?");

      expect(alerts).toHaveLength(1);
      expect(assignments).toHaveLength(1);
      expect(conversation()).toEqual(afterEscalation);
    });
  });

  describe("the agent does not take the conversation over", () => {
    it("is handed to the next agent by the timer, still escalated", async () => {
      const first = agentWithPhone("51911111111");
      const second = agentWithPhone("51922222222");
      await customerWrites("no");
      expect([first, second]).toContain(conversation().assignedAgent!);
      db.prepare(
        "UPDATE conversations SET assignment_notified_at = ? WHERE tenant_id = ? AND phone_number = ?",
      ).run(Date.now() - 10 * 60 * 1000, tenant.tenantId, CUSTOMER);

      await checkAndReassignTimeouts();

      const after = conversation();
      expect(after.assignedAgent).not.toBeNull();
      expect(after).toMatchObject({
        status: "human_takeover",
        handoverReason: "multiple_objections",
        phase: { phase: "escalated" },
      });
      expect(after.notifiedAt).toBeGreaterThan(Date.now() - 60 * 1000);
      expect(assignments).toHaveLength(2);
    });
  });
});

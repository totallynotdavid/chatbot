/**
 * What the person holding a conversation hears when the customer keeps
 * writing. Each test sends real inbound messages through `handleMessage` and
 * reads what reaches the network: staff alerts, read receipts and typing
 * indicators. The only fake is the network.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import process from "node:process";
import { Hono } from "hono";
import type { ConversationPhase } from "@vendeya/core";
import type { ConversationRef, DomainEvent } from "@vendeya/types";

import { db } from "../src/db/index.ts";
import { handleMessage } from "../src/conversation/handler/index.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import {
  sendManualMessage,
  takeoverConversation,
} from "../src/domains/conversations/write.ts";
import { requireAuth } from "../src/middleware/auth.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import conversationRoutes from "../src/routes/conversations.ts";
import { notify } from "../src/domains/notifications/notify.ts";
import { TenantSettings } from "../src/domains/settings/system.ts";
import { eventBus } from "../src/shared/events/index.ts";
import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

const CUSTOMER = "51900777001";
const AGENT_PHONE = "51911000001";
const SALES_GROUP = "120363000000000001@g.us";

const SECOND_OBJECTION: ConversationPhase = {
  phase: "handling_objection",
  segment: "fnb",
  credit: 3000,
  name: "Ana",
  objectionCount: 2,
};

const ALERTED_EVENTS: DomainEvent["type"][] = [
  "agent_assigned",
  "escalation_triggered",
  "customer_message_received",
];

type StaffMessage = { to: string; body: string };
type ReadReceipt = { messageId: string; typing: boolean };

describe("writing to a conversation a person holds", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let agent: string;
  let originalFetch: typeof globalThis.fetch;
  let staffMessages: StaffMessage[];
  let receipts: ReadReceipt[];
  let staffSendsFail: boolean;
  // The next send to the agent waits here, and the value says how it ends.
  let agentSendGate: Promise<"refuse" | "accept"> | null;
  let agentSendPending: PromiseWithResolvers<void>;
  let unsubscribe: Array<() => void>;

  async function conversationFetch(
    _url: unknown,
    init?: RequestInit,
  ): Promise<Response> {
    const body = JSON.parse(String(init?.body));
    if (body.status === "read") {
      receipts.push({
        messageId: body.message_id,
        typing: "typing_indicator" in body,
      });
      return new Response("{}");
    }
    let refused = staffSendsFail;
    if (body.to === AGENT_PHONE && agentSendGate) {
      const gate = agentSendGate;
      agentSendGate = null;
      agentSendPending.resolve();
      refused = (await gate) === "refuse";
    }
    if (refused && body.to === AGENT_PHONE) {
      return new Response(JSON.stringify({ error: { message: "refused" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    staffMessages.push({ to: body.to, body: body.text.body });
    return new Response(JSON.stringify({ messages: [{ id: "wamid-ok" }] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async function customerWrites(text: string): Promise<string> {
    const messageId = `wamid-${crypto.randomUUID()}`;
    await handleMessage({
      ref,
      content: text,
      timestamp: Date.now() - 11 * 60 * 1000,
      messageId,
    });
    return messageId;
  }

  const sentTo = (to: string, containing: string) =>
    staffMessages.filter((m) => m.to === to && m.body.includes(containing));

  const agentMessageAlerts = () => sentTo(AGENT_PHONE, "escribió");
  const agentEscalationAlerts = () => sentTo(AGENT_PHONE, "requiere atención");

  function giveAgentAPhone() {
    db.prepare("UPDATE users SET phone_number = ? WHERE id = ?").run(
      AGENT_PHONE,
      agent,
    );
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("held-alerts");
    // A number that genuinely sends, so the adapter reaches the fake network.
    db.prepare("DELETE FROM channel_accounts WHERE id = ?").run(
      tenant.channelAccountId,
    );
    const account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: tenant.phoneNumberId,
      accessToken: "EAAG-a-real-looking-token",
    });
    tenant.channelAccountId = account.id;
    ref = {
      tenantId: tenant.tenantId,
      channelAccountId: account.id,
      phoneNumber: CUSTOMER,
    };
    insertConversation(ref, {
      contextData: {
        phase: SECOND_OBJECTION,
        metadata: { createdAt: Date.now(), lastActivityAt: Date.now() },
      },
    });
    agent = createMember(tenant, "sales_agent").userId;
    TenantSettings.set(tenant.tenantId, "whatsapp_group_sales", SALES_GROUP);

    staffMessages = [];
    receipts = [];
    staffSendsFail = false;
    agentSendGate = null;
    agentSendPending = Promise.withResolvers<void>();
    // The production handler of these events, without the global subscribers.
    unsubscribe = ALERTED_EVENTS.map((type) => {
      const handler = async (event: DomainEvent) => {
        if (event.tenantId !== tenant.tenantId) return;
        await notify(event);
      };
      eventBus.on(type, handler);
      return () => eventBus.off(type, handler);
    });

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) =>
      conversationFetch(url, init)) as unknown as typeof fetch;
  });

  afterEach(() => {
    for (const off of unsubscribe) off();
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    db.prepare("DELETE FROM audit_log WHERE user_id = ?").run(agent);
    dropTenantFixture(tenant);
  });

  describe("after the bot escalated to an assigned agent", () => {
    beforeEach(() => giveAgentAPhone());

    it("alerts the agent once, however long the customer keeps writing", async () => {
      await customerWrites("no");
      expect(agentEscalationAlerts()).toHaveLength(1);

      await customerWrites("hola?");
      await customerWrites("¿alguien me atiende?");

      expect(agentEscalationAlerts()).toHaveLength(1);
      expect(agentMessageAlerts()).toEqual([]);
    });

    it("alerts about the next message when the escalation alert did not go out", async () => {
      staffSendsFail = true;
      await customerWrites("no");
      expect(agentEscalationAlerts()).toEqual([]);

      staffSendsFail = false;
      await customerWrites("¿alguien me atiende?");
      await customerWrites("¿hola?");

      expect(agentMessageAlerts()).toHaveLength(1);
    });

    it("alerts the next agent about a message after the first one declined", async () => {
      const other = createMember(tenant, "sales_agent").userId;
      const otherPhone = "51911000002";
      db.prepare("UPDATE users SET phone_number = ? WHERE id = ?").run(
        otherPhone,
        other,
      );

      await customerWrites("no");
      const holder = db
        .prepare(
          "SELECT assigned_agent FROM conversations WHERE tenant_id = ? AND phone_number = ?",
        )
        .get(tenant.tenantId, CUSTOMER) as { assigned_agent: string };
      const heir = holder.assigned_agent === agent ? other : agent;
      const heirPhone = heir === agent ? AGENT_PHONE : otherPhone;

      const token = generateSessionToken();
      createSession(token, holder.assigned_agent, tenant.tenantId);
      const app = new Hono();
      app.use("/api/*", requireAuth);
      app.route("/api/conversations", conversationRoutes);
      const declined = await app.request(
        `/api/conversations/${CUSTOMER}/decline-assignment?channel=${tenant.channelAccountId}`,
        { method: "POST", headers: { Cookie: `session=${token}` } },
      );
      expect(declined.status).toBe(200);
      staffMessages.length = 0;

      await customerWrites("¿alguien me atiende?");
      await customerWrites("¿hola?");

      expect(sentTo(heirPhone, "escribió")).toHaveLength(1);
      db.prepare("DELETE FROM audit_log WHERE user_id = ?").run(
        holder.assigned_agent,
      );
    });

    it("alerts again about a message once the agent has answered", async () => {
      await customerWrites("no");
      await sendManualMessage(ref, "Hola Ana, te atiendo", agent);
      staffMessages.length = 0;

      await customerWrites("gracias, ¿y el precio?");
      await customerWrites("¿sigues ahí?");

      expect(agentMessageAlerts()).toHaveLength(1);
      expect(agentMessageAlerts()[0]!.body).toContain(
        `/dashboard/conversations/${CUSTOMER}?channel=${tenant.channelAccountId}`,
      );
      expect(staffMessages.filter((m) => m.to === SALES_GROUP)).toEqual([]);
    });
  });

  describe("after an agent took the conversation over", () => {
    beforeEach(async () => {
      giveAgentAPhone();
      await takeoverConversation(ref, agent);
    });

    it("tells the agent about a message, then waits for their answer", async () => {
      await customerWrites("hola, sigo esperando");
      await customerWrites("¿me escuchan?");
      expect(agentMessageAlerts()).toHaveLength(1);

      await sendManualMessage(ref, "Ya te atiendo", agent);
      await customerWrites("perfecto");
      await customerWrites("gracias");

      expect(agentMessageAlerts()).toHaveLength(2);
    });

    it("alerts again after a message alert that did not go out", async () => {
      staffSendsFail = true;
      await customerWrites("hola, sigo esperando");
      expect(agentMessageAlerts()).toEqual([]);

      staffSendsFail = false;
      await customerWrites("¿me escuchan?");
      await customerWrites("¿hola?");

      expect(agentMessageAlerts()).toHaveLength(1);
    });

    it("alerts on a message that arrives while an alert send is still pending and then fails", async () => {
      const send = Promise.withResolvers<"refuse" | "accept">();
      agentSendGate = send.promise;

      const first = customerWrites("hola, sigo esperando");
      await agentSendPending.promise;
      const second = customerWrites("¿me escuchan?");

      // Let the second message run as far as it can with the send pending. It
      // finishes only if the first turn did not wait for that send.
      await Promise.race([second, new Promise((r) => setImmediate(r))]);
      send.resolve("refuse");
      await Promise.all([first, second]);

      expect(agentMessageAlerts()).toHaveLength(1);
    });

    it("sends the customer a read receipt but no typing indicator", async () => {
      const messageId = await customerWrites("hola");

      expect(receipts).toEqual([{ messageId, typing: false }]);
    });
  });

  describe("while nobody is assigned", () => {
    it("leaves the sales group with the escalation alert alone", async () => {
      await customerWrites("no");
      await customerWrites("hola?");
      await customerWrites("¿alguien me atiende?");

      expect(sentTo(SALES_GROUP, "requiere atención")).toHaveLength(1);
      expect(staffMessages.filter((m) => m.body.includes("escribió"))).toEqual(
        [],
      );
    });
  });

  describe("while the bot owns the conversation", () => {
    it("shows the customer the typing indicator", async () => {
      const messageId = await customerWrites("no");

      expect(receipts).toEqual([{ messageId, typing: true }]);
    });
  });
});

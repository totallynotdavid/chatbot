/**
 * Where an alert points, and whether it was really sent.
 *
 * Two regressions, both from the same blind spot - a conversation is (tenant,
 * channel account, phone number), and a notification is sent from a channel
 * account that may not be able to send:
 *
 *  - the links in these alerts named the contact's phone number alone, so for a
 *    tenant with a second WhatsApp number the dashboard answered them with 409
 *    "ambiguous" instead of the conversation;
 *  - the dispatcher dropped `sendDirect`'s answer, so an alert refused by the
 *    Cloud adapter (a pending or disabled number cannot send) was recorded as
 *    delivered.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import process from "node:process";

import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { db } from "../src/db/index.ts";
import { notificationRules } from "../src/domains/notifications/config.ts";
import { evaluateNotifications } from "../src/domains/notifications/evaluator.ts";
import {
  accountForEvent,
  dispatchNotifications,
} from "../src/domains/notifications/dispatcher.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { SystemSettings } from "../src/domains/settings/system.ts";
import type { DomainEvent } from "@totem/types";

const CUSTOMER = "51987654321";
const CHANNEL = "ch-notifications-fixture";

function contentFor(event: DomainEvent): string {
  const decisions = evaluateNotifications(event, notificationRules);
  const sent = decisions.find((decision) => decision.status === "sent");

  if (!sent || sent.status !== "sent") {
    throw new Error(`No notification was produced for ${event.type}`);
  }

  return sent.content;
}

describe("the link an alert carries", () => {
  const base = {
    traceId: "trace-1",
    timestamp: Date.now(),
    tenantId: "tn-notifications",
    channelAccountId: CHANNEL,
  };

  const expectedLink = `/dashboard/conversations/${CUSTOMER}?channel=${CHANNEL}`;

  it("names the thread on an assignment", () => {
    expect(
      contentFor({
        ...base,
        type: "agent_assigned",
        payload: {
          phoneNumber: CUSTOMER,
          agentId: "u-1",
          agentPhone: "51900000001",
          clientName: "Ana",
          dni: "12345678",
        },
      }),
    ).toContain(expectedLink);
  });

  it("names the thread on an escalation", () => {
    expect(
      contentFor({
        ...base,
        type: "escalation_triggered",
        payload: { phoneNumber: CUSTOMER, reason: "multiple_objections" },
      }),
    ).toContain(expectedLink);
  });

  it("names the thread when attention is required", () => {
    expect(
      contentFor({
        ...base,
        type: "attention_required",
        payload: {
          phoneNumber: CUSTOMER,
          clientName: "Ana",
          dni: "12345678",
          reason: "manual_review",
        },
      }),
    ).toContain(expectedLink);
  });

  it("names the thread on a contract upload", () => {
    expect(
      contentFor({
        ...base,
        type: "contract_uploaded",
        payload: {
          phoneNumber: CUSTOMER,
          clientName: "Ana",
          contractPath: "/api/assets/a-1",
        },
      }),
    ).toContain(expectedLink);
  });

  it("names the thread on an enrichment loop alert", () => {
    expect(
      contentFor({
        ...base,
        type: "enrichment_limit_exceeded",
        payload: { phoneNumber: CUSTOMER, lastPhase: "offering_products" },
      }),
    ).toContain(expectedLink);
  });

  it("still links an order to the order, not the conversation", () => {
    const content = contentFor({
      ...base,
      type: "order_created",
      payload: {
        orderId: "ord-1",
        orderNumber: "A-001",
        amount: 1799,
        clientName: "Ana",
        phoneNumber: CUSTOMER,
        dni: "12345678",
        productName: "Combo",
      },
    } as DomainEvent);

    expect(content).toContain("/dashboard/orders/ord-1");
  });
});

describe("dispatching an alert on a number that cannot send", () => {
  let tenant: TenantFixture;
  let pendingAccountId: string;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("notifications");

    // A number registered but not yet able to send: the Cloud adapter refuses
    // it, which is the case that used to be recorded as a delivery.
    pendingAccountId = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: `pnid-${crypto.randomUUID().slice(0, 8)}`,
      label: "Pendiente",
    }).id;
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  function trace(traceId: string): { status: string; reason: string | null } {
    return db
      .prepare(
        "SELECT status, reason FROM notification_traces WHERE trace_id = ?",
      )
      .get(traceId) as { status: string; reason: string | null };
  }

  it("records it as failed, not sent", async () => {
    const traceId = `trace-${crypto.randomUUID()}`;

    await dispatchNotifications(
      [
        {
          status: "sent",
          content: "Ana espera atención.",
          target: "51900000001",
          ruleId: "agent_assignment_whatsapp",
          channel: "whatsapp",
        },
      ],
      {
        type: "agent_assigned",
        traceId,
        timestamp: Date.now(),
        tenantId: tenant.tenantId,
        channelAccountId: pendingAccountId,
        payload: {
          phoneNumber: CUSTOMER,
          agentId: "u-1",
          agentPhone: "51900000001",
          clientName: "Ana",
        },
      },
    );

    expect(trace(traceId)).toEqual({
      status: "failed",
      reason: "send_failed",
    });
  });
});

/**
 * Alerts that belong to no tenant.
 *
 * `notification_traces.tenant_id` is nullable because a few events really are
 * the platform's: both eligibility providers being down is one deployment-wide
 * outage, and GET /api/providers/:dni raises it with no conversation - and so
 * no tenant and no channel account - behind it. Requiring a tenant account
 * before sending turned that alert into a `no_channel_account` trace and
 * nothing delivered, which is the dev team not being told the bot is blind.
 *
 * They go out on the platform's own operations account now: the
 * `platform_ops_channel_account_id` setting, else PLATFORM_OPS_PHONE_NUMBER_ID,
 * else WHATSAPP_PHONE_ID - the number they were sent from before tenancy.
 */
describe("a platform-wide alert with no tenant", () => {
  const SECRETS_KEY = "d4".repeat(32);
  /** What the rule's "dev" target resolves to: VendeYa's own operations group. */
  const DEV_GROUP = "51900000999@g.us";

  let tenant: TenantFixture;
  let opsAccountId: string;
  let opsPhoneNumberId: string;
  let sends: Array<{ url: string; to: string; body: string }>;

  const saved: Record<string, string | undefined> = {};
  const originalFetch = globalThis.fetch;

  function setEnv(key: string, value: string | undefined): void {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  /** The event GET /api/providers/:dni raises: no tenant, no channel account. */
  function outageEvent(traceId: string): DomainEvent {
    return {
      type: "system_outage_detected",
      traceId,
      timestamp: Date.now(),
      payload: { dni: "12345678", errors: ["fnb 503", "powerbi 503"] },
    } as DomainEvent;
  }

  function outageDecisions(): Parameters<typeof dispatchNotifications>[0] {
    return [
      {
        status: "sent",
        content: "Ambos proveedores caídos.",
        target: DEV_GROUP,
        ruleId: "system_outage_alert",
        channel: "whatsapp",
      },
    ];
  }

  function trace(traceId: string): {
    status: string;
    reason: string | null;
    tenant_id: string | null;
  } {
    return db
      .prepare(
        "SELECT status, reason, tenant_id FROM notification_traces WHERE trace_id = ?",
      )
      .get(traceId) as {
      status: string;
      reason: string | null;
      tenant_id: string | null;
    };
  }

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("platform-ops");

    setEnv("SECRETS_KEY", SECRETS_KEY);
    setEnv("PLATFORM_OPS_PHONE_NUMBER_ID", undefined);
    setEnv("WHATSAPP_PHONE_ID", undefined);

    // VendeYa's own number: a real account that can send, which the platform
    // owns rather than borrowing from whichever tenant is at hand.
    const account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: `pnid-ops-${crypto.randomUUID().slice(0, 8)}`,
      label: "VendeYa Ops",
      accessToken: "ops-token",
    });
    opsAccountId = account.id;
    opsPhoneNumberId = account.phone_number_id;

    sends = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = input.toString();
      const body = init?.body ? JSON.parse(init.body) : {};
      sends.push({ url, to: body.to, body: body.text?.body ?? "" });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.ops" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const key of Object.keys(saved)) delete saved[key];
    db.prepare("DELETE FROM system_settings WHERE key = ?").run(
      "platform_ops_channel_account_id",
    );
    db.prepare("DELETE FROM notification_traces WHERE tenant_id IS NULL").run();
    dropTenantFixture(tenant);
  });

  it("goes out on the designated platform operations account", async () => {
    SystemSettings.set("platform_ops_channel_account_id", opsAccountId);

    const traceId = `trace-${crypto.randomUUID()}`;
    await dispatchNotifications(outageDecisions(), outageEvent(traceId));

    expect(trace(traceId)).toEqual({
      status: "sent",
      reason: null,
      tenant_id: null,
    });

    expect(sends).toHaveLength(1);
    expect(sends[0]!.url).toContain(`/${opsPhoneNumberId}/messages`);
    expect(sends[0]!.to).toBe(DEV_GROUP);
    expect(sends[0]!.body).toBe("Ambos proveedores caídos.");
  });

  it("falls back to the number the alert used before tenancy", async () => {
    // No designation stored: WHATSAPP_PHONE_ID is where these went out from
    // when there was one global token, and it still resolves.
    setEnv("WHATSAPP_PHONE_ID", opsPhoneNumberId);

    const traceId = `trace-${crypto.randomUUID()}`;
    await dispatchNotifications(outageDecisions(), outageEvent(traceId));

    expect(trace(traceId).status).toBe("sent");
    expect(sends[0]!.url).toContain(`/${opsPhoneNumberId}/messages`);
  });

  it("prefers the designated account over the environment", async () => {
    const other = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: `pnid-env-${crypto.randomUUID().slice(0, 8)}`,
      label: "Otro",
      accessToken: "other-token",
    });
    setEnv("WHATSAPP_PHONE_ID", other.phone_number_id);
    SystemSettings.set("platform_ops_channel_account_id", opsAccountId);

    const traceId = `trace-${crypto.randomUUID()}`;
    await dispatchNotifications(outageDecisions(), outageEvent(traceId));

    expect(sends[0]!.url).toContain(`/${opsPhoneNumberId}/messages`);
  });

  it("records why nothing went out when the platform names no account", async () => {
    const traceId = `trace-${crypto.randomUUID()}`;
    await dispatchNotifications(outageDecisions(), outageEvent(traceId));

    expect(trace(traceId)).toEqual({
      status: "failed",
      reason: "no_channel_account",
      tenant_id: null,
    });
    expect(sends).toHaveLength(0);
  });

  it("still prefers the tenant's own account when the event names one", async () => {
    SystemSettings.set("platform_ops_channel_account_id", opsAccountId);

    expect(
      accountForEvent({
        type: "system_error_occurred",
        traceId: "trace-scoped",
        timestamp: Date.now(),
        tenantId: tenant.tenantId,
        channelAccountId: tenant.channelAccountId,
        payload: { phoneNumber: CUSTOMER, error: "boom" },
      } as DomainEvent)?.id,
    ).toBe(tenant.channelAccountId);
  });
});

/**
 * Covers the work that reaches a tenant's rows without a pinned tenant. Inbox
 * aggregation, customer sends and the reassignment cron run without a session.
 * A platform operator's exports read across tenants. Each path has to check the
 * tenant's status itself, because no pinned scope filters it.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as XLSX from "xlsx";

import process from "node:process";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  createMember,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { getReadyForAggregation } from "../src/conversation/message-inbox.ts";
import { checkAndReassignTimeouts } from "../src/domains/conversations/assignment.ts";
import { ReportService } from "../src/domains/reports/index.ts";
import { createOrder } from "../src/domains/orders/write.ts";
import { WhatsAppService } from "../src/adapters/whatsapp/index.ts";
import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import { DevAdapter } from "../src/adapters/whatsapp/dev-adapter.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import type { ChannelAccount } from "@totem/types";

const CUSTOMER = "51900222333";

describe("a suspended tenant", () => {
  let open: TenantFixture;
  let closed: TenantFixture;

  function suspend(tenantId: string): void {
    db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(
      tenantId,
    );
  }

  function queueMessage(fixture: TenantFixture, text: string): void {
    db.prepare(
      `INSERT INTO message_inbox
         (tenant_id, channel_account_id, phone_number, message_text, message_id,
          whatsapp_timestamp, status, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 'pending', ?)`,
    ).run(
      fixture.tenantId,
      fixture.channelAccountId,
      CUSTOMER,
      text,
      `wamid-${crypto.randomUUID()}`,
      Date.now() - 60_000,
    );
  }

  beforeEach(() => {
    applySchema();
    open = createTenantFixture("open-biz");
    closed = createTenantFixture("closed-biz");
  });

  afterEach(() => {
    dropTenantFixture(open);
    dropTenantFixture(closed);
  });

  describe("stops the aggregator from answering what was already queued", () => {
    it("leaves its pending messages out of the dequeue", () => {
      queueMessage(open, "hola");
      queueMessage(closed, "hola");

      const before = getReadyForAggregation(0).map((g) => g.tenant_id);
      expect(before).toContain(open.tenantId);
      expect(before).toContain(closed.tenantId);

      suspend(closed.tenantId);

      const after = getReadyForAggregation(0).map((g) => g.tenant_id);
      expect(after).not.toContain(closed.tenantId);
      // The other business is still being served.
      expect(after).toContain(open.tenantId);
    });

    it("leaves them pending rather than dropping them", () => {
      queueMessage(closed, "hola");
      suspend(closed.tenantId);

      getReadyForAggregation(0);

      // Reactivating the tenant has to resume where it left off, so the row is
      // skipped, not consumed.
      expect(
        db
          .prepare(
            "SELECT status FROM message_inbox WHERE tenant_id = ? LIMIT 1",
          )
          .get(closed.tenantId),
      ).toEqual({ status: "pending" });
    });
  });

  /**
   * `resolveAccount` gates every customer-facing send. The account is `active`
   * and has a real token, so without the tenant check the adapter would call
   * Meta. The tests assert that no request is made.
   */
  describe("sends nothing on a customer conversation", () => {
    let sends: number;
    let originalFetch: typeof globalThis.fetch;
    let savedKey: string | undefined;

    beforeEach(() => {
      savedKey = process.env.SECRETS_KEY;
      process.env.SECRETS_KEY = "d4".repeat(32);

      sends = 0;
      originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        sends++;
        return new Response(
          JSON.stringify({ messages: [{ id: "wamid-sent" }] }),
          { headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      if (savedKey === undefined) delete process.env.SECRETS_KEY;
      else process.env.SECRETS_KEY = savedKey;
    });

    /** A number that is genuinely able to send: active, with a token. */
    function sendableRef(fixture: TenantFixture) {
      const account = ChannelAccountService.create({
        tenantId: fixture.tenantId,
        phoneNumberId: `pnid-${crypto.randomUUID().slice(0, 8)}`,
        accessToken: "EAAG-a-real-looking-token",
      });
      const ref = {
        tenantId: fixture.tenantId,
        channelAccountId: account.id,
        phoneNumber: CUSTOMER,
      };
      insertConversation(ref);
      return ref;
    }

    it("makes no request, and records the reply as failed", async () => {
      const ref = sendableRef(closed);

      suspend(closed.tenantId);
      await WhatsAppService.sendMessage(ref, "¿Sigue ahí?");

      expect(sends).toBe(0);

      const history = MessageStore.getHistory(ref);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        direction: "outbound",
        status: "failed",
      });
    });

    it("still sends for a tenant that is open", async () => {
      const ref = sendableRef(open);

      await WhatsAppService.sendMessage(ref, "¿Sigue ahí?");

      expect(sends).toBe(1);
      expect(MessageStore.getHistory(ref)[0]).toMatchObject({
        status: "sent",
      });
    });
  });

  describe("stops the reassignment cron", () => {
    /** A conversation whose agent was paged and never answered. */
    function timedOut(fixture: TenantFixture, agentId: string): void {
      insertConversation(fixture.ref(CUSTOMER), {
        status: "human_takeover",
        assignedAgent: agentId,
      });
      db.prepare(
        `UPDATE conversations
         SET assignment_notified_at = ?, handover_reason = NULL
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
      ).run(
        Date.now() - 10 * 60 * 1000,
        fixture.tenantId,
        fixture.channelAccountId,
        CUSTOMER,
      );
    }

    function assignmentOf(fixture: TenantFixture) {
      return db
        .prepare(
          `SELECT assigned_agent, assignment_notified_at FROM conversations
           WHERE tenant_id = ? AND phone_number = ?`,
        )
        .get(fixture.tenantId, CUSTOMER) as {
        assigned_agent: string | null;
        assignment_notified_at: number | null;
      };
    }

    it("leaves its conversations assigned where they are", () => {
      const closedAgent = createMember(closed, "sales_agent");
      const openAgent = createMember(open, "sales_agent");

      timedOut(closed, closedAgent.userId);
      timedOut(open, openAgent.userId);

      const staleNotifiedAt = assignmentOf(closed).assignment_notified_at;

      suspend(closed.tenantId);

      checkAndReassignTimeouts();

      // The assignment is not cleared, so no agent of a closed business is
      // paged for a conversation it cannot answer.
      expect(assignmentOf(closed)).toEqual({
        assigned_agent: closedAgent.userId,
        assignment_notified_at: staleNotifiedAt,
      });

      // The cron still processes the open tenant: its agent is notified again
      // just now.
      expect(assignmentOf(open).assigned_agent).toBe(openAgent.userId);
      expect(assignmentOf(open).assignment_notified_at).toBeGreaterThan(
        staleNotifiedAt!,
      );
    });
  });

  describe("is left out of a platform operator's exports", () => {
    const range = {
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };

    /** The rows an .xlsx buffer actually carries. */
    function rowsOf(buffer: Buffer): Array<Record<string, unknown>> {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
      return XLSX.utils.sheet_to_json(sheet);
    }

    it("out of the activity report", () => {
      insertConversation(open.ref(CUSTOMER), { clientName: "Open Client" });
      insertConversation(closed.ref(CUSTOMER), { clientName: "Closed Client" });

      suspend(closed.tenantId);

      const names = rowsOf(
        ReportService.generateActivityReport({
          tenantId: null,
          ...range,
          segments: ["all"],
          saleStatuses: ["all"],
        }) as Buffer,
      ).map((row) => row.Nombre);

      expect(names).toContain("Open Client");
      expect(names).not.toContain("Closed Client");
    });

    it("out of the order report", () => {
      for (const fixture of [open, closed]) {
        insertConversation(fixture.ref(CUSTOMER));
        createOrder({
          ref: fixture.ref(CUSTOMER),
          clientName: fixture === open ? "Open Buyer" : "Closed Buyer",
          clientDni: "12345678",
          products: [
            { productId: "p1", name: "Terma", price: 200, quantity: 1 },
          ],
          totalAmount: 200,
          deliveryAddress: "Lima",
        });
      }

      suspend(closed.tenantId);

      const buyers = rowsOf(
        ReportService.generateOrderReport({
          tenantId: null,
          ...range,
        }) as Buffer,
      ).map((row) => row.Cliente);

      expect(buyers).toContain("Open Buyer");
      expect(buyers).not.toContain("Closed Buyer");
    });
  });
});

/**
 * Production refuses any account that is not `active`
 * (adapters/whatsapp/cloud-api.ts). The dev adapter applies the same check
 * because a half-configured number is most likely to exist in development.
 * Sending for it there would make dev behave as though the number worked.
 */
describe("the dev adapter", () => {
  let tenant: TenantFixture;
  let account: ChannelAccount;
  let calls: number;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("dev-adapter");
    account = ChannelAccountService.getById(tenant.channelAccountId)!;

    calls = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ status: "ok", messageId: "m-1" }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    dropTenantFixture(tenant);
  });

  it("sends for an active account", async () => {
    expect(await DevAdapter.sendMessage(account, CUSTOMER, "hola")).toEqual({
      ok: true,
      messageId: "m-1",
    });
    expect(calls).toBe(1);
  });

  for (const status of ["pending", "disabled"] as const) {
    it(`refuses to send for a ${status} account`, async () => {
      const inactive = { ...account, status };

      const refused = {
        ok: false as const,
        kind: "permanent" as const,
        reason: "account_not_active",
      };
      expect(await DevAdapter.sendMessage(inactive, CUSTOMER, "hola")).toEqual(
        refused,
      );
      expect(
        await DevAdapter.sendImage(inactive, CUSTOMER, "images/x.jpg"),
      ).toEqual(refused);

      // The refusal happens before any request. The send did not fail on the
      // wire.
      expect(calls).toBe(0);
    });
  }
});

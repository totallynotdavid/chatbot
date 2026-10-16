/**
 * A bot reply that `WhatsAppService` refuses before the adapter is called must
 * not vanish. Each test sends through `WhatsAppService.sendMessage` and runs the
 * outbox worker's real handoff pass. The only fake is the network, and a
 * refused send must never reach it.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import process from "node:process";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import type { ConversationRef, DomainEvent } from "@vendeya/types";

import {
  ChannelUnavailableError,
  WhatsAppService,
} from "../src/adapters/whatsapp/index.ts";
import type { OutboxRow } from "../src/conversation/outbox.ts";
import { processDueOutbox } from "../src/conversation/outbox-worker.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { createLogger } from "../src/lib/logger.ts";
import { eventBus } from "../src/shared/events/index.ts";

const CUSTOMER = "51900777001";

describe("a reply WhatsAppService refuses before it reaches the adapter", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let originalFetch: typeof globalThis.fetch;
  let requests: number;
  let alerts: DomainEvent[];

  const onAlert = (event: DomainEvent) => {
    if (event.tenantId === tenant.tenantId) alerts.push(event);
  };

  function outboxOf(of: ConversationRef): OutboxRow[] {
    return db
      .prepare(
        `SELECT * FROM outbox
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
         ORDER BY id`,
      )
      .all(of.tenantId, of.channelAccountId, of.phoneNumber) as OutboxRow[];
  }

  function outboundStatuses(of: ConversationRef): string[] {
    return (
      db
        .prepare(
          `SELECT status FROM messages
           WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
             AND direction = 'outbound'
           ORDER BY created_at, ROWID`,
        )
        .all(of.tenantId, of.channelAccountId, of.phoneNumber) as Array<{
        status: string;
      }>
    ).map((row) => row.status);
  }

  function messageCount(): number {
    return (
      db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }
    ).n;
  }

  function conversationOf(of: ConversationRef) {
    return db
      .prepare(
        `SELECT status, handover_reason FROM conversations
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
      )
      .get(of.tenantId, of.channelAccountId, of.phoneNumber) as {
      status: string;
      handover_reason: string | null;
    };
  }

  function setTenantStatus(status: "active" | "suspended"): void {
    db.prepare("UPDATE tenants SET status = ? WHERE id = ?").run(
      status,
      tenant.tenantId,
    );
  }

  /** The JSON lines the loggers wrote at warn level or above while `run` ran. */
  async function warningsDuring(
    run: () => Promise<void>,
  ): Promise<Array<Record<string, any>>> {
    // Every logger shares the root logger's stream, which pino keeps under a
    // symbol on the root of the prototype chain.
    let stream: { write: (line: string) => unknown } | undefined;
    for (
      let node: object | null = createLogger("refused-send-test");
      node && !stream;
      node = Object.getPrototypeOf(node)
    ) {
      for (const symbol of Object.getOwnPropertySymbols(node)) {
        if (symbol.description === "pino.stream") {
          stream = (node as Record<symbol, any>)[symbol];
        }
      }
    }
    if (!stream) throw new Error("The logger stream could not be found");

    const lines: string[] = [];
    const write = spyOn(stream, "write");
    write.mockImplementation((line: string) => {
      lines.push(line);
      return true;
    });
    try {
      await run();
    } finally {
      write.mockRestore();
    }

    return lines
      .map((line) => JSON.parse(line) as Record<string, any>)
      .filter((entry) => entry.level >= 40);
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("refused-send");
    // A number that genuinely sends, so a refusal is the only thing that
    // keeps a reply off the fake network.
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
    insertConversation(ref);

    alerts = [];
    eventBus.on("escalation_triggered", onAlert);

    requests = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      requests++;
      return new Response(JSON.stringify({ messages: [{ id: "wamid-ok" }] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    eventBus.off("escalation_triggered", onAlert);
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  describe("for a tenant that is not active", () => {
    it("records a failed outbox row, and says nothing to the customer", async () => {
      setTenantStatus("suspended");

      const outcome = await WhatsAppService.sendMessage(ref, "¿Sigue ahí?", {
        retry: true,
      });

      expect(outcome).toMatchObject({
        ok: false,
        kind: "permanent",
        reason: "tenant_not_active",
      });
      expect(requests).toBe(0);
      expect(outboundStatuses(ref)).toEqual(["failed"]);
      expect(outboxOf(ref)).toMatchObject([
        {
          status: "failed",
          attempts: 1,
          last_kind: "permanent",
          last_reason: "tenant_not_active",
          handed_off_at: null,
        },
      ]);
    });

    it("alerts nobody while it stays suspended", async () => {
      setTenantStatus("suspended");
      await WhatsAppService.sendMessage(ref, "¿Sigue ahí?", { retry: true });

      await processDueOutbox();

      expect(alerts).toEqual([]);
      expect(outboxOf(ref)[0]!.handed_off_at).toBeNull();
      expect(conversationOf(ref).status).toBe("active");
      expect(requests).toBe(0);
    });

    it("hands the conversation to a person once, when the tenant reopens", async () => {
      setTenantStatus("suspended");
      await WhatsAppService.sendMessage(ref, "¿Sigue ahí?", { retry: true });
      await processDueOutbox();

      setTenantStatus("active");
      await processDueOutbox();
      await processDueOutbox();

      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.payload).toMatchObject({
        reason: "reply_undeliverable",
        phoneNumber: CUSTOMER,
      });
      expect(outboxOf(ref)[0]!.handed_off_at).toBeGreaterThan(0);
      expect(conversationOf(ref)).toMatchObject({
        handover_reason: "reply_undeliverable",
      });
      expect(requests).toBe(0);
    });

    it("keeps a manual reply out of the outbox, so the agent sees the error", async () => {
      setTenantStatus("suspended");

      const outcome = await WhatsAppService.sendMessage(ref, "Buenas tardes");

      expect(outcome).toMatchObject({
        ok: false,
        kind: "permanent",
        reason: "tenant_not_active",
      });
      expect(outboxOf(ref)).toEqual([]);
      expect(outboundStatuses(ref)).toEqual(["failed"]);

      setTenantStatus("active");
      await processDueOutbox();
      expect(alerts).toEqual([]);
    });
  });

  /**
   * `messages` and `outbox` both reference the pair (channel account, tenant)
   * and the conversation. A ref that names no account, or an account of another
   * tenant, names no conversation either, so no row can record the reply and
   * no handoff can find one.
   */
  describe("for a ref no row can describe", () => {
    let other: TenantFixture | undefined;

    const cases = [
      {
        name: "an account that does not exist",
        reason: "account_not_found",
        refusedRef: () => ({
          tenantId: tenant.tenantId,
          channelAccountId: "ch-missing",
          phoneNumber: CUSTOMER,
        }),
      },
      {
        name: "an account of another tenant",
        reason: "tenant_mismatch",
        refusedRef: () => {
          other = createTenantFixture("refused-send-other");
          return {
            tenantId: tenant.tenantId,
            channelAccountId: other.channelAccountId,
            phoneNumber: CUSTOMER,
          };
        },
      },
    ];

    for (const { name, reason, refusedRef } of cases) {
      for (const retry of [true, false]) {
        it(`refuses ${name} as a permanent outcome${retry ? " for a bot reply" : " for a manual reply"}, and writes nothing`, async () => {
          const refused = refusedRef();
          const before = messageCount();

          const outcome = await WhatsAppService.sendMessage(refused, "hola", {
            retry,
          });

          expect(outcome).toMatchObject({
            ok: false,
            kind: "permanent",
            reason,
          });
          expect(requests).toBe(0);
          expect(messageCount()).toBe(before);
          expect(outboxOf(refused)).toEqual([]);
        });
      }

      it(`logs ${name} at error level, naming the account`, async () => {
        const refused = refusedRef();

        const warnings = await warningsDuring(async () => {
          await WhatsAppService.sendMessage(refused, "hola", { retry: true });
        });

        expect(warnings.filter((line) => line.level >= 50)).toContainEqual(
          expect.objectContaining({
            channelAccountId: refused.channelAccountId,
          }),
        );
      });
    }

    afterEach(() => {
      dropTenantFixture(other);
      other = undefined;
    });
  });

  describe("for an account that is switched off", () => {
    it("throws, queues nothing, alerts nobody, and logs which account", async () => {
      ChannelAccountService.updateStatus(tenant.channelAccountId, "disabled");

      let error: unknown;
      const warnings = await warningsDuring(async () => {
        error = await WhatsAppService.sendMessage(ref, "¿Sigue ahí?", {
          retry: true,
        }).catch((caught) => caught);
      });

      expect(error).toBeInstanceOf(ChannelUnavailableError);
      expect(requests).toBe(0);
      expect(outboxOf(ref)).toEqual([]);
      expect(warnings).toContainEqual(
        expect.objectContaining({
          channelAccountId: tenant.channelAccountId,
          status: "disabled",
        }),
      );

      await processDueOutbox();
      expect(alerts).toEqual([]);
    });
  });
});

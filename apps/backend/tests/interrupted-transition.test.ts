/**
 * What a transition leaves behind when one of its sends is refused.
 *
 * Round 15 made a number switched off mid-flight a failure the queue can see:
 * the send throws `ChannelUnavailableError` and the aggregator puts the message
 * back to be answered once the number returns. That fixed the message and not
 * the conversation. `executeCommands` persisted the new phase before running
 * the commands and wrote TRACK_EVENT rows as it met them, so by the time the
 * send threw, the conversation had moved on and the analytics had been written
 * - for a reply the customer never received. The orchestrator did the same with
 * the transition's domain events, one of which creates an order.
 *
 * A requeued message is only safe to answer again if answering it the first
 * time recorded nothing. These check that it recorded nothing, and that the
 * retry then does everything exactly once.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import process from "node:process";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { GREETING } from "@totem/core";
import type {
  ConversationMetadata,
  ConversationPhase,
  TransitionResult,
} from "@totem/core";
import type { ChannelAccount, ConversationRef } from "@totem/types";

import { getReadyForAggregation } from "../src/conversation/message-inbox.ts";
import {
  processGroup,
  processReadyMessages,
} from "../src/conversation/aggregator-worker.ts";
import { executeCommands } from "../src/conversation/handler/command-executor.ts";
import { ChannelUnavailableError } from "../src/adapters/whatsapp/index.ts";
import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { BundleService } from "../src/domains/catalog/bundles.ts";
import { eventBus } from "../src/shared/events/index.ts";

const CUSTOMER = "51900777001";

describe("a send refused partway through a transition", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  /** A number that genuinely sends: active, with a token behind it. */
  let account: ChannelAccount;
  let ref: ConversationRef;
  let sends: number;
  /** Runs inside the send that makes this count, before it answers. */
  let onSend: (count: number) => void;
  let originalFetch: typeof globalThis.fetch;

  function setStatus(status: ChannelAccount["status"]): void {
    ChannelAccountService.updateStatus(account.id, status);
  }

  function queue(text: string): void {
    db.prepare(
      `INSERT INTO message_inbox
         (tenant_id, channel_account_id, phone_number, message_text, message_id,
          whatsapp_timestamp, status, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 'pending', ?)`,
    ).run(
      ref.tenantId,
      ref.channelAccountId,
      ref.phoneNumber,
      text,
      `wamid-${crypto.randomUUID()}`,
      Date.now() - 60_000,
    );
  }

  /** Dequeued while the number is on, then switched off before the reply. */
  async function answerWithNumberSwitchedOffMidFlight(): Promise<void> {
    const group = getReadyForAggregation(0).find(
      (g) => g.channel_account_id === account.id,
    );
    if (!group) throw new Error("The queued message was not dequeued");

    setStatus("disabled");
    await processGroup(group);
  }

  function queueStatuses(): string[] {
    return (
      db
        .prepare(
          "SELECT status FROM message_inbox WHERE channel_account_id = ? ORDER BY id",
        )
        .all(account.id) as Array<{ status: string }>
    ).map((row) => row.status);
  }

  function storedPhase(): ConversationPhase {
    const row = db
      .prepare(
        `SELECT context_data FROM conversations
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
      )
      .get(ref.tenantId, ref.channelAccountId, ref.phoneNumber) as {
      context_data: string;
    };
    return JSON.parse(row.context_data).phase;
  }

  function analytics(eventType: string): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM analytics_events
           WHERE channel_account_id = ? AND phone_number = ? AND event_type = ?`,
        )
        .get(account.id, CUSTOMER, eventType) as { c: number }
    ).c;
  }

  function outbound(): Array<{ content: string; status: string }> {
    return MessageStore.getHistory(ref, 100)
      .filter((m) => m.direction === "outbound")
      .reverse()
      .map((m) => ({ content: m.content, status: m.status }));
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("interrupted");
    account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: `pnid-${crypto.randomUUID().slice(0, 8)}`,
      accessToken: "EAAG-a-real-looking-token",
    });
    ref = {
      tenantId: tenant.tenantId,
      channelAccountId: account.id,
      phoneNumber: CUSTOMER,
    };

    sends = 0;
    onSend = () => {};
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      sends++;
      onSend(sends);
      return new Response(
        JSON.stringify({ messages: [{ id: `wamid-out-${sends}` }] }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  /**
   * The review's scenario, as it happens: a new contact says "hola", the
   * greeting transition tracks `session_start` and then sends, and the number
   * is switched off in between.
   */
  describe("on a new contact's first message", () => {
    beforeEach(() => {
      queue("hola");
    });

    it("neither moves the conversation on nor counts a session", async () => {
      await answerWithNumberSwitchedOffMidFlight();

      expect(queueStatuses()).toEqual(["pending"]);
      // Still waiting to be greeted - not `confirming_client`, which would
      // read the next "hola" as the answer to a question never asked.
      expect(storedPhase()).toEqual({ phase: "greeting" });
      expect(analytics("session_start")).toBe(0);
      expect(sends).toBe(0);
    });

    it("greets them, once, when the number comes back", async () => {
      await answerWithNumberSwitchedOffMidFlight();

      setStatus("active");
      await processReadyMessages();

      expect(queueStatuses()).toEqual(["processed"]);
      expect(storedPhase()).toEqual({ phase: "confirming_client" });
      expect(analytics("session_start")).toBe(1);

      // The retry answered with the greeting itself, and it went out.
      const greetings = GREETING.flat();
      const last = outbound().at(-1);
      expect(last?.status).toBe("sent");
      expect(greetings).toContain(last?.content ?? "");
    });
  });

  /**
   * The same shape one layer up. `purchase_confirmed` is a domain event the
   * orchestrator emits, and its subscriber creates the order - so with the
   * phase now correctly left in `confirming_selection`, emitting it before the
   * sends would have made the retry confirm the same sale twice.
   */
  describe("on a purchase confirmation", () => {
    let confirmations: number;
    const countConfirmation = () => {
      confirmations++;
    };

    beforeEach(() => {
      insertConversation(ref, {
        contextData: {
          phase: {
            phase: "confirming_selection",
            segment: "fnb",
            credit: 5000,
            name: "Juan",
            selectedProduct: {
              name: "Cocina 4 hornillas",
              price: 1200,
              productId: "prod-cocina",
            },
          },
          metadata: {
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            dni: "12345678",
          },
        },
      });
      queue("sí");

      confirmations = 0;
      eventBus.on("purchase_confirmed", countConfirmation);
    });

    afterEach(() => {
      eventBus.off("purchase_confirmed", countConfirmation);
    });

    it("confirms nothing until the confirmation reaches the customer", async () => {
      await answerWithNumberSwitchedOffMidFlight();

      expect(queueStatuses()).toEqual(["pending"]);
      expect(confirmations).toBe(0);
      expect(analytics("purchase_confirmed")).toBe(0);
      expect(storedPhase().phase).toBe("confirming_selection");
    });

    it("confirms the sale exactly once when the number comes back", async () => {
      await answerWithNumberSwitchedOffMidFlight();

      setStatus("active");
      await processReadyMessages();

      expect(queueStatuses()).toEqual(["processed"]);
      expect(confirmations).toBe(1);
      expect(analytics("purchase_confirmed")).toBe(1);
      expect(storedPhase().phase).toBe("closing");
    });
  });

  describe("in executeCommands itself", () => {
    const metadata = {
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    } as ConversationMetadata;

    /**
     * The tradeoff, pinned down rather than implied. A message that went out
     * before the refusal is not taken back and is sent again on the retry; what
     * the batch records - the phase, the analytics - is written once, after the
     * last send, and never for a batch that did not finish.
     */
    it("repeats a message that went out before the refusal, and records nothing until the batch completes", async () => {
      insertConversation(ref);

      const batch: TransitionResult = {
        type: "update",
        nextPhase: { phase: "confirming_client" },
        commands: [
          { type: "SEND_MESSAGE", text: "uno" },
          { type: "TRACK_EVENT", event: "session_start" },
          { type: "SEND_MESSAGE", text: "dos" },
        ],
      };

      // The first message goes out, and the number is switched off before the
      // second.
      onSend = (count) => {
        if (count === 1) setStatus("disabled");
      };

      await expect(
        executeCommands(batch, ref, metadata, false, "trace-1"),
      ).rejects.toThrow(ChannelUnavailableError);

      expect(outbound()).toEqual([
        { content: "uno", status: "sent" },
        { content: "dos", status: "failed" },
      ]);
      // The TRACK_EVENT sat *between* the two sends and still was not written.
      expect(analytics("session_start")).toBe(0);
      expect(storedPhase()).toEqual({ phase: "greeting" });

      onSend = () => {};
      setStatus("active");

      await executeCommands(batch, ref, metadata, false, "trace-2");

      expect(outbound()).toEqual([
        { content: "uno", status: "sent" },
        { content: "dos", status: "failed" },
        // The accepted duplicate.
        { content: "uno", status: "sent" },
        { content: "dos", status: "sent" },
      ]);
      expect(analytics("session_start")).toBe(1);
      expect(storedPhase()).toEqual({ phase: "confirming_client" });
    });

    /**
     * Deferring the write must not lose what an image or bundle command adds to
     * the phase. Those used to persist their own `sentProducts` straight after
     * the upfront write; persisting the plain `nextPhase` last would have
     * silently overwritten them, and the next message could no longer be matched
     * against the products the customer had just been shown.
     */
    it("keeps the products a bundle command showed on the phase it persists", async () => {
      const periodId = `per-${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO catalog_periods (id, tenant_id, name, year_month, status)
         VALUES (?, ?, 'Enero', '2026-01', 'active')`,
      ).run(periodId, tenant.tenantId);

      const bundleId = `bundle-${crypto.randomUUID()}`;
      BundleService.create({
        id: bundleId,
        tenantId: tenant.tenantId,
        period_id: periodId,
        segment: "fnb",
        name: "Cocina 4 hornillas",
        price: 1200,
        primary_category: "cocinas",
        categories_json: JSON.stringify(["cocinas"]),
        image_id: "abcdef0123456789",
        composition_json: JSON.stringify({ fixed: [], choices: [] }),
        installments_json: JSON.stringify([{ months: 12, monthlyAmount: 110 }]),
        created_by: null,
      });

      insertConversation(ref);

      await executeCommands(
        {
          type: "update",
          nextPhase: {
            phase: "offering_products",
            segment: "fnb",
            credit: 5000,
            name: "Juan",
          },
          commands: [{ type: "SEND_BUNDLE", bundleId }],
        },
        ref,
        metadata,
        false,
        "trace-bundle",
      );

      expect(storedPhase()).toMatchObject({
        phase: "offering_products",
        sentProducts: [{ productId: bundleId, position: 1, price: 1200 }],
        lastAction: { type: "showed_products", productCount: 1 },
      });
    });
  });
});

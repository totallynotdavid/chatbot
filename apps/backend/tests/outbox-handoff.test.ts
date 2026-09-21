/**
 * A reply that ends `failed` leaves the customer without an answer, so the
 * conversation goes to a person. Each test drives the real worker pass with a
 * clock it controls, and the only fake is the network.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import process from "node:process";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import type { ConversationMetadata, ConversationPhase } from "@vendeya/core";
import type { ConversationRef, DomainEvent } from "@vendeya/types";

import { executeCommands } from "../src/conversation/handler/command-executor.ts";
import { WhatsAppService } from "../src/adapters/whatsapp/index.ts";
import { MAX_AGE_MS, type OutboxRow } from "../src/conversation/outbox.ts";
import { createLogger } from "../src/lib/logger.ts";
import {
  processDueOutbox,
  startOutboxWorker,
  stopOutboxWorker,
} from "../src/conversation/outbox-worker.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { notificationRules } from "../src/domains/notifications/config.ts";
import { evaluateNotifications } from "../src/domains/notifications/evaluator.ts";
import { takeoverConversation } from "../src/domains/conversations/write.ts";
import { eventBus } from "../src/shared/events/index.ts";

const CUSTOMER = "51900999001";
const OTHER_CUSTOMER = "51900999002";

type ConversationState = {
  status: string;
  handover_reason: string | null;
  phase: ConversationPhase;
};

describe("handing a conversation to a person when a reply cannot be delivered", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let agent: string;
  let originalFetch: typeof globalThis.fetch;
  let answer: () => Response;
  /** The `escalation_triggered` events this tenant's conversations emitted. */
  let alerts: DomainEvent[];

  const accepted = () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid-ok" }] }), {
      headers: { "Content-Type": "application/json" },
    });
  /** A 502 with an HTML body: the adapter classifies it `transient`. */
  const unreachable = () =>
    new Response("<html>Bad gateway</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });
  /** Meta's re-engagement error: the adapter classifies it `permanent`. */
  const refused = () =>
    new Response(JSON.stringify({ error: { code: 131047 } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  /** A reset connection: the adapter classifies it `ambiguous`. */
  const reset = (): Response => {
    throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
  };

  const onAlert = (event: DomainEvent) => {
    if (event.tenantId === tenant.tenantId) alerts.push(event);
  };

  function rowsOf(of: ConversationRef): OutboxRow[] {
    return db
      .prepare(
        `SELECT * FROM outbox
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
         ORDER BY id`,
      )
      .all(of.tenantId, of.channelAccountId, of.phoneNumber) as OutboxRow[];
  }

  function message(id: string): { status: string } {
    return db.prepare("SELECT status FROM messages WHERE id = ?").get(id) as {
      status: string;
    };
  }

  function conversationOf(of: ConversationRef): ConversationState {
    const row = db
      .prepare(
        `SELECT status, handover_reason, context_data FROM conversations
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
      )
      .get(of.tenantId, of.channelAccountId, of.phoneNumber) as {
      status: string;
      handover_reason: string | null;
      context_data: string;
    };
    return {
      status: row.status,
      handover_reason: row.handover_reason,
      phase: JSON.parse(row.context_data).phase,
    };
  }

  /** Queue one reply by letting its inline send fail the way `answer` says. */
  async function queue(text: string, of = ref): Promise<OutboxRow> {
    const before = rowsOf(of).length;
    await WhatsAppService.sendMessage(of, text, { retry: true });
    const queued = rowsOf(of);
    expect(queued).toHaveLength(before + 1);
    return queued[before]!;
  }

  /**
   * Leaves a row `failed` with no handoff, as a crash between the failure and
   * the handoff would. The worker pass that fails a row also hands it off, so a
   * test that needs the gap writes the state itself.
   */
  function failWithoutHandoff(row: OutboxRow, reason = "expired"): void {
    db.prepare(
      "UPDATE outbox SET status = 'failed', last_reason = ? WHERE id = ?",
    ).run(reason, row.id);
    db.prepare("UPDATE messages SET status = 'failed' WHERE id = ?").run(
      row.message_id,
    );
  }

  /** The JSON lines the loggers wrote at error level while `run` ran. */
  async function errorLogsDuring(
    run: () => Promise<void>,
  ): Promise<Array<Record<string, any>>> {
    // Every logger shares the root logger's stream, which pino keeps under a
    // symbol on the root of the prototype chain.
    let stream: { write: (line: string) => unknown } | undefined;
    for (
      let node: object | null = createLogger("outbox-handoff-test");
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
      .filter((entry) => entry.level === 50);
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("outbox-handoff");
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
    insertConversation(ref);
    agent = createMember(tenant, "sales_agent").userId;

    alerts = [];
    eventBus.on("escalation_triggered", onAlert);

    answer = accepted;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => answer()) as unknown as typeof fetch;
  });

  afterEach(async () => {
    await stopOutboxWorker();
    eventBus.off("escalation_triggered", onAlert);
    db.prepare("DROP TRIGGER IF EXISTS refuse_handoff_test").run();
    db.prepare("DROP TRIGGER IF EXISTS refuse_stamp_test").run();
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    db.prepare("DELETE FROM audit_log WHERE user_id = ?").run(agent);
    dropTenantFixture(tenant);
  });

  describe("every route to a failed row", () => {
    /**
     * Each route queues two replies, so the second one is still pending when the
     * first fails. It runs the passes that fail the first row.
     */
    const routes: Array<{
      name: string;
      lastReason: string;
      queueWith: () => Response;
      failFirst: (first: OutboxRow, second: OutboxRow) => Promise<void>;
    }> = [
      {
        name: "five transient failures",
        lastReason: "exhausted",
        queueWith: unreachable,
        failFirst: async () => {
          for (let pass = 0; pass < 4; pass++) {
            expect(rowsOf(ref)[0]!.status).toBe("pending");
            expect(alerts).toEqual([]);
            await processDueOutbox(rowsOf(ref)[0]!.next_attempt_at);
          }
        },
      },
      {
        name: "expiry",
        lastReason: "expired",
        queueWith: unreachable,
        failFirst: async (first, second) => {
          // The second reply is younger than the age limit, so only the first expires.
          db.prepare("UPDATE outbox SET created_at = ? WHERE id = ?").run(
            first.created_at + 1_000,
            second.id,
          );
          await processDueOutbox(first.created_at + MAX_AGE_MS);
        },
      },
      {
        name: "a refusal for good on a retry",
        lastReason: "http_400:131047",
        queueWith: unreachable,
        failFirst: async (first) => {
          answer = refused;
          await processDueOutbox(first.next_attempt_at);
        },
      },
      {
        name: "a second ambiguous outcome",
        lastReason: "network:ECONNRESET",
        queueWith: reset,
        failFirst: async (first) => {
          await processDueOutbox(first.next_attempt_at);
        },
      },
    ];

    for (const route of routes) {
      it(`hands the conversation off within the pass that ends in ${route.name}`, async () => {
        answer = route.queueWith;
        const first = await queue("primero");
        const second = await queue("segundo");

        await route.failFirst(first, second);

        expect(rowsOf(ref)[0]).toMatchObject({
          status: "failed",
          last_reason: route.lastReason,
        });
        expect(rowsOf(ref)[0]!.handed_off_at).toBeGreaterThan(0);
        expect(message(first.message_id).status).toBe("failed");

        expect(conversationOf(ref)).toMatchObject({
          status: "human_takeover",
          handover_reason: "reply_undeliverable",
          phase: { phase: "escalated", reason: "reply_undeliverable" },
        });

        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toMatchObject({
          type: "escalation_triggered",
          tenantId: ref.tenantId,
          channelAccountId: ref.channelAccountId,
          payload: {
            phoneNumber: CUSTOMER,
            reason: "reply_undeliverable",
            context: { failedReplies: 1, lastReason: route.lastReason },
          },
        });

        expect(rowsOf(ref)[1]).toMatchObject({
          id: second.id,
          status: "cancelled",
          handed_off_at: null,
        });
        expect(message(second.message_id).status).toBe("cancelled");
      });
    }

    it("changes nothing and emits nothing on a second pass", async () => {
      answer = unreachable;
      const first = await queue("primero");
      await queue("segundo");
      await processDueOutbox(first.created_at + MAX_AGE_MS);
      expect(alerts).toHaveLength(1);

      const rows = rowsOf(ref);
      const conversation = conversationOf(ref);

      await processDueOutbox(first.created_at + MAX_AGE_MS + 60_000);
      await processDueOutbox(first.created_at + MAX_AGE_MS + 120_000);

      expect(alerts).toHaveLength(1);
      expect(rowsOf(ref)).toEqual(rows);
      expect(conversationOf(ref)).toEqual(conversation);
    });

    it("hands off a reply refused for good on the first inline send, which is kept as a failed row", async () => {
      answer = refused;
      await WhatsAppService.sendMessage(ref, "hola", { retry: true });
      expect(rowsOf(ref)[0]).toMatchObject({
        status: "failed",
        attempts: 1,
        handed_off_at: null,
      });

      await processDueOutbox();

      expect(rowsOf(ref)[0]!.handed_off_at).toBeGreaterThan(0);
      expect(conversationOf(ref).handover_reason).toBe("reply_undeliverable");
      expect(alerts).toHaveLength(1);
    });
  });

  describe("a conversation a person or the bot already holds", () => {
    const metadata = {
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    } as ConversationMetadata;

    it("keeps the state and reason the bot escalated with, and still sends one alert", async () => {
      answer = unreachable;
      // The advisor message is the reply that never goes out.
      await executeCommands(
        {
          type: "update",
          nextPhase: {
            phase: "escalated",
            reason: "multiple_objections",
          } as ConversationPhase,
          commands: [
            {
              type: "SEND_MESSAGE",
              text: "Un asesor te contactará en breve",
            },
          ],
        },
        ref,
        metadata,
        false,
        "trace",
      );
      const advisorMessage = rowsOf(ref)[0]!;
      const before = conversationOf(ref);
      expect(before).toMatchObject({
        status: "human_takeover",
        handover_reason: "multiple_objections",
      });

      await processDueOutbox(advisorMessage.created_at + MAX_AGE_MS);

      expect(rowsOf(ref)[0]).toMatchObject({ status: "failed" });
      expect(rowsOf(ref)[0]!.handed_off_at).toBeGreaterThan(0);
      expect(conversationOf(ref)).toEqual(before);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.payload).toMatchObject({
        reason: "reply_undeliverable",
      });
    });

    it("keeps the reason of a person's takeover, and still sends one alert", async () => {
      answer = unreachable;
      const failed = await queue("primero");
      failWithoutHandoff(failed);
      await takeoverConversation(ref, agent);
      const before = conversationOf(ref);
      expect(before.handover_reason).toBe("Manual takeover by agent");

      await processDueOutbox();

      expect(rowsOf(ref)[0]!.handed_off_at).toBeGreaterThan(0);
      expect(conversationOf(ref)).toEqual(before);
      expect(alerts).toHaveLength(1);
    });
  });

  it("sends one alert for two rows that fail together, and marks both", async () => {
    answer = unreachable;
    await queue("primero");
    const second = await queue("segundo");

    await processDueOutbox(second.created_at + MAX_AGE_MS);

    expect(rowsOf(ref).map((row) => row.status)).toEqual(["failed", "failed"]);
    expect(rowsOf(ref).map((row) => row.handed_off_at !== null)).toEqual([
      true,
      true,
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({
      context: { failedReplies: 2, lastReason: "expired" },
    });
  });

  it("leaves a suspended tenant alone until it reopens", async () => {
    answer = unreachable;
    const failed = await queue("primero");
    const behind = await queue("segundo");
    failWithoutHandoff(failed);
    db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(
      tenant.tenantId,
    );

    await processDueOutbox();

    expect(rowsOf(ref)[0]!.handed_off_at).toBeNull();
    expect(rowsOf(ref)[1]!.status).toBe("pending");
    expect(conversationOf(ref).status).toBe("active");
    expect(alerts).toEqual([]);

    db.prepare("UPDATE tenants SET status = 'active' WHERE id = ?").run(
      tenant.tenantId,
    );
    await processDueOutbox();

    expect(rowsOf(ref)[0]!.handed_off_at).toBeGreaterThan(0);
    expect(rowsOf(ref)[1]!.status).toBe("cancelled");
    expect(message(behind.message_id).status).toBe("cancelled");
    expect(conversationOf(ref).handover_reason).toBe("reply_undeliverable");
    expect(alerts).toHaveLength(1);
  });

  describe("at boot", () => {
    it("hands off a failed row that was never handed off", async () => {
      answer = unreachable;
      const failed = await queue("primero");
      failWithoutHandoff(failed);

      startOutboxWorker();
      await stopOutboxWorker();

      expect(rowsOf(ref)[0]!.handed_off_at).toBeGreaterThan(0);
      expect(conversationOf(ref).handover_reason).toBe("reply_undeliverable");
      expect(alerts).toHaveLength(1);
    });

    it("hands off a row that boot recovery fails as a second ambiguous outcome", async () => {
      answer = reset;
      const row = await queue("primero");
      expect(row.ambiguous_attempts).toBe(1);
      db.prepare("UPDATE outbox SET status = 'sending' WHERE id = ?").run(
        row.id,
      );

      startOutboxWorker();
      await stopOutboxWorker();

      expect(rowsOf(ref)[0]).toMatchObject({
        status: "failed",
        last_reason: "interrupted",
      });
      expect(rowsOf(ref)[0]!.handed_off_at).toBeGreaterThan(0);
      expect(alerts).toHaveLength(1);
    });
  });

  it("emits the alert before it stamps the rows, so a failure in between costs a second alert and never a missed one", async () => {
    answer = unreachable;
    const failed = await queue("primero");
    failWithoutHandoff(failed);
    db.prepare(
      `CREATE TRIGGER refuse_stamp_test BEFORE UPDATE OF handed_off_at ON outbox
       BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`,
    ).run();

    await errorLogsDuring(() => processDueOutbox());

    expect(alerts).toHaveLength(1);
    expect(rowsOf(ref)[0]!.handed_off_at).toBeNull();
    expect(conversationOf(ref).handover_reason).toBe("reply_undeliverable");

    db.prepare("DROP TRIGGER refuse_stamp_test").run();
    await processDueOutbox();

    expect(alerts).toHaveLength(2);
    expect(rowsOf(ref)[0]!.handed_off_at).toBeGreaterThan(0);

    await processDueOutbox();
    expect(alerts).toHaveLength(2);
  });

  it("does not let one conversation's error stop another's handoff, and names the ids", async () => {
    answer = unreachable;
    const broken = await queue("primero");
    const otherRef = { ...ref, phoneNumber: OTHER_CUSTOMER };
    insertConversation(otherRef);
    const healthy = await queue("primero", otherRef);
    failWithoutHandoff(broken);
    failWithoutHandoff(healthy);

    db.prepare(
      `CREATE TRIGGER refuse_handoff_test BEFORE UPDATE ON conversations
       WHEN NEW.phone_number = '${CUSTOMER}' AND NEW.status = 'human_takeover'
       BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`,
    ).run();

    const logs = await errorLogsDuring(() => processDueOutbox());

    expect(rowsOf(otherRef)[0]!.handed_off_at).toBeGreaterThan(0);
    expect(conversationOf(otherRef).handover_reason).toBe(
      "reply_undeliverable",
    );
    expect(alerts).toHaveLength(1);

    expect(rowsOf(ref)[0]!.handed_off_at).toBeNull();
    expect(conversationOf(ref).status).toBe("active");

    const failure = logs.find((entry) => entry.module === "outbox-handoff");
    expect(failure).toMatchObject({
      tenantId: ref.tenantId,
      channelAccountId: ref.channelAccountId,
      outboxIds: [broken.id],
    });
    expect(JSON.stringify(failure)).not.toContain(CUSTOMER);

    // Nothing was lost: the next pass, with the fault gone, finishes the job.
    db.prepare("DROP TRIGGER refuse_handoff_test").run();
    await processDueOutbox();

    expect(rowsOf(ref)[0]!.handed_off_at).toBeGreaterThan(0);
    expect(conversationOf(ref).handover_reason).toBe("reply_undeliverable");
    expect(alerts).toHaveLength(2);
  });

  describe("the alert the advisor reads", () => {
    it("says in Spanish that a reply could not be delivered", () => {
      const decisions = evaluateNotifications(
        {
          type: "escalation_triggered",
          traceId: "trace-1",
          timestamp: Date.now(),
          tenantId: "tn-1",
          channelAccountId: "ch-1",
          payload: {
            phoneNumber: CUSTOMER,
            reason: "reply_undeliverable",
            context: { failedReplies: 1, lastReason: "exhausted" },
          },
        },
        notificationRules,
      );
      const sent = decisions.find((decision) => decision.status === "sent");

      expect(sent?.status === "sent" && sent.content).toContain(
        "Motivo: No se pudo entregar una respuesta al cliente",
      );
    });
  });
});

/**
 * A turn that cannot work out a reply must not leave the customer unanswered
 * and unnoticed. Each test sends a real signed webhook and runs the aggregator
 * and the outbox worker's handoff pass over the inbox it filled. The only fakes
 * are the network and the enrichment step that stands in for the LLM.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import process from "node:process";
import { join } from "node:path";

import type { ConversationPhase } from "@vendeya/core";
import type { DomainEvent } from "@vendeya/types";

import { db } from "../src/db/index.ts";
import {
  processReadyMessages,
  startAggregatorWorker,
  stopAggregatorWorker,
} from "../src/conversation/aggregator-worker.ts";
import { enrichmentRegistry } from "../src/conversation/enrichment/registry.ts";
import { processDueOutbox } from "../src/conversation/outbox-worker.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { eventBus } from "../src/shared/events/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";
import { customerWrites } from "./helpers/turn.ts";

const CUSTOMER = "51900888001";

const OBJECTION: ConversationPhase = {
  phase: "handling_objection",
  segment: "fnb",
  credit: 3000,
  name: "Ana",
  objectionCount: 1,
};

/** What the objection phase answers when the message is not a question. */
const FOLLOW_UP = "¿Te gustaría ver alguna otra opción?";

describe("a customer whose turn fails", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let originalFetch: typeof globalThis.fetch;
  /** Replies WhatsApp accepted, in order. */
  let delivered: string[];
  let alerts: DomainEvent[];
  /** Turns that reached the reply step. */
  let attempts: number;
  /** How many of those throw before one succeeds. */
  let failures: number;
  /** Runs inside a reply step attempt, before it throws or answers. */
  let whileAnswering: Record<number, () => Promise<void>>;

  const onAlert = (event: DomainEvent) => {
    if (event.tenantId === tenant.tenantId) alerts.push(event);
  };

  /** The reply step: the first `failures` calls throw, the rest say "not a question". */
  function replyStep() {
    enrichmentRegistry.clear();
    enrichmentRegistry.register({
      type: "detect_question",
      execute: async () => {
        attempts++;
        await whileAnswering[attempts]?.();
        if (attempts <= failures) throw new Error("the model is down");
        return { type: "question_detected", isQuestion: false };
      },
    });
  }

  function inbox() {
    return db
      .prepare(
        `SELECT status, attempts, last_error, handed_off_at FROM message_inbox
         WHERE channel_account_id = ? ORDER BY id`,
      )
      .all(tenant.channelAccountId) as Array<{
      status: string;
      attempts: number;
      last_error: string | null;
      handed_off_at: number | null;
    }>;
  }

  function conversation() {
    return db
      .prepare(
        `SELECT status, handover_reason FROM conversations
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
      )
      .get(tenant.tenantId, tenant.channelAccountId, CUSTOMER) as {
      status: string;
      handover_reason: string | null;
    };
  }

  function outboundRows(): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM messages
           WHERE channel_account_id = ? AND direction = 'outbound'`,
        )
        .get(tenant.channelAccountId) as { n: number }
    ).n;
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "a7".repeat(32);

    applySchema();
    tenant = createTenantFixture("turn-recovery");
    // A number that genuinely sends, so a reply reaches the fake network.
    db.prepare("DELETE FROM channel_accounts WHERE id = ?").run(
      tenant.channelAccountId,
    );
    const account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: tenant.phoneNumberId,
      accessToken: "EAAG-a-real-looking-token",
    });
    tenant.channelAccountId = account.id;

    insertConversation(
      {
        tenantId: tenant.tenantId,
        channelAccountId: account.id,
        phoneNumber: CUSTOMER,
      },
      {
        contextData: {
          phase: OBJECTION,
          metadata: { createdAt: Date.now(), lastActivityAt: Date.now() },
        },
      },
    );

    delivered = [];
    alerts = [];
    attempts = 0;
    failures = 0;
    whileAnswering = {};
    replyStep();
    eventBus.on("escalation_triggered", onAlert);

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.type === "text") delivered.push(body.text.body);
      return new Response(
        JSON.stringify({ messages: [{ id: `wamid-out-${delivered.length}` }] }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(async () => {
    await stopAggregatorWorker();
    eventBus.off("escalation_triggered", onAlert);
    enrichmentRegistry.clear();
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  it("is answered once when the reply step throws once and then works", async () => {
    failures = 1;
    await customerWrites(tenant, CUSTOMER, "mmm lo voy a pensar");

    await processReadyMessages();
    expect(delivered).toEqual([]);
    expect(inbox()).toMatchObject([{ status: "pending", attempts: 1 }]);

    await processReadyMessages();
    await processReadyMessages();

    expect(delivered).toEqual([FOLLOW_UP]);
    expect(inbox()).toMatchObject([{ status: "processed", attempts: 1 }]);
    expect(conversation().status).toBe("active");
    expect(alerts).toEqual([]);
  });

  it("is handed to a person with a reason when the reply step always throws", async () => {
    failures = Infinity;
    await customerWrites(tenant, CUSTOMER, "mmm lo voy a pensar");

    await processReadyMessages();
    await processReadyMessages();
    // Nothing is left to try, so a third pass finds no ready row.
    await processReadyMessages();
    expect(attempts).toBe(2);
    expect(inbox()).toMatchObject([
      { status: "failed", attempts: 2, last_error: "the model is down" },
    ]);

    await processDueOutbox();

    expect(delivered).toEqual([]);
    expect(conversation()).toEqual({
      status: "human_takeover",
      handover_reason: "turn_failed",
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({
      reason: "turn_failed",
      context: { failedTurns: 1, lastReason: "the model is down" },
    });
    expect(inbox()[0]!.handed_off_at).not.toBeNull();

    // The handoff is by state, so a later pass does not alert again.
    await processDueOutbox();
    expect(alerts).toHaveLength(1);
  });

  it("hands off a message that joined after the first failure, with the older one", async () => {
    failures = Infinity;
    await customerWrites(tenant, CUSTOMER, "mmm lo voy a pensar");
    await processReadyMessages();
    expect(inbox()).toMatchObject([{ status: "pending", attempts: 1 }]);

    await customerWrites(tenant, CUSTOMER, "¿y si lo dejo para después?");
    await processReadyMessages();

    expect(attempts).toBe(2);
    expect(inbox()).toMatchObject([
      { status: "failed", attempts: 2 },
      { status: "failed", attempts: 2 },
    ]);

    await processDueOutbox();

    expect(conversation().handover_reason).toBe("turn_failed");
    expect(alerts).toHaveLength(1);
    expect(inbox().every((row) => row.handed_off_at !== null)).toBe(true);
    // Nothing is left pending for a silent answer after the handoff.
    await processReadyMessages();
    expect(attempts).toBe(2);
    expect(delivered).toEqual([]);
  });

  it("hands off a message that arrives while the last attempt runs", async () => {
    failures = Infinity;
    whileAnswering[2] = () =>
      customerWrites(tenant, CUSTOMER, "¿y si lo dejo para después?");
    await customerWrites(tenant, CUSTOMER, "mmm lo voy a pensar");
    await processReadyMessages();

    await processReadyMessages();
    expect(attempts).toBe(2);
    expect(inbox()).toMatchObject([
      { status: "failed", attempts: 2 },
      { status: "failed", attempts: 2 },
    ]);

    await processDueOutbox();

    expect(alerts).toHaveLength(1);
    expect(inbox().every((row) => row.handed_off_at !== null)).toBe(true);
    await processReadyMessages();
    expect(attempts).toBe(2);
    expect(delivered).toEqual([]);
  });

  it("hands off a message that arrived while the dead process ran its last attempt", async () => {
    failures = Infinity;
    await customerWrites(tenant, CUSTOMER, "mmm lo voy a pensar");
    db.prepare(
      `UPDATE message_inbox SET status = 'processing', attempts = 1
       WHERE channel_account_id = ?`,
    ).run(tenant.channelAccountId);
    await customerWrites(tenant, CUSTOMER, "¿y si lo dejo para después?");

    startAggregatorWorker();
    await stopAggregatorWorker();

    expect(inbox()).toMatchObject([
      { status: "failed", attempts: 2 },
      { status: "failed", attempts: 2 },
    ]);
    await processDueOutbox();
    expect(alerts).toHaveLength(1);
    expect(attempts).toBe(0);
  });

  it("fails together the rows a dead process left with different attempts", async () => {
    failures = Infinity;
    await customerWrites(tenant, CUSTOMER, "mmm lo voy a pensar");
    await customerWrites(tenant, CUSTOMER, "¿y si lo dejo para después?");
    db.prepare(
      `UPDATE message_inbox SET status = 'processing', attempts = id % 2
       WHERE channel_account_id = ?`,
    ).run(tenant.channelAccountId);
    expect(
      inbox()
        .map((row) => row.attempts)
        .sort(),
    ).toEqual([0, 1]);

    startAggregatorWorker();
    await stopAggregatorWorker();

    expect(inbox()).toMatchObject([
      { status: "failed", attempts: 2 },
      { status: "failed", attempts: 2 },
    ]);
  });

  it("is answered after the backend is killed mid-turn, with no duplicate send", async () => {
    await customerWrites(tenant, CUSTOMER, "mmm lo voy a pensar");

    const child = Bun.spawn(
      ["bun", "run", join(import.meta.dir, "helpers", "hung-turn-child.ts")],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          NODE_ENV: "test",
          DB_PATH: process.env.DB_PATH!,
          UPLOAD_DIR: process.env.UPLOAD_DIR!,
          PRIVATE_DIR: process.env.PRIVATE_DIR!,
          LOG_DIR: process.env.LOG_DIR!,
          SECRETS_KEY: process.env.SECRETS_KEY!,
        },
      },
    );

    try {
      const decoder = new TextDecoder();
      let output = "";
      for await (const chunk of child.stdout) {
        output += decoder.decode(chunk, { stream: true });
        if (output.includes("mid-turn")) break;
      }
      expect(output).toContain("mid-turn");

      child.kill("SIGKILL");
      await child.exited;
    } finally {
      child.kill("SIGKILL");
    }

    expect(inbox()).toMatchObject([{ status: "processing", attempts: 0 }]);
    expect(delivered).toEqual([]);

    // The next boot settles the dead turn and the worker answers it.
    startAggregatorWorker();
    const deadline = Date.now() + 10_000;
    while (inbox()[0]!.status !== "processed" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await stopAggregatorWorker();
    await processReadyMessages();

    expect(delivered).toEqual([FOLLOW_UP]);
    expect(outboundRows()).toBe(1);
    expect(inbox()).toMatchObject([{ status: "processed", attempts: 1 }]);
    expect(alerts).toEqual([]);
  });
});

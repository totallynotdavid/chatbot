/**
 * The worker sends a conversation's queued replies, one at a time and in the
 * order the bot produced them, until each goes out or its budget runs out. The
 * pass takes the clock, so no test waits on a timer, and the only fake is the
 * network.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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

import type { ConversationMetadata, ConversationPhase } from "@totem/core";
import type { ConversationMessage, ConversationRef } from "@totem/types";

import { executeCommands } from "../src/conversation/handler/command-executor.ts";
import { CloudApiAdapter } from "../src/adapters/whatsapp/cloud-api.ts";
import { WhatsAppService } from "../src/adapters/whatsapp/index.ts";
import {
  claimRow,
  MAX_AGE_MS,
  OUTBOX_RETENTION_MS,
  purgeFinishedOutbox,
  type OutboxRow,
} from "../src/conversation/outbox.ts";
import {
  processDueOutbox,
  startOutboxWorker,
  stopOutboxWorker,
} from "../src/conversation/outbox-worker.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { takeoverConversation } from "../src/domains/conversations/write.ts";

const CUSTOMER = "51900999001";

/** How much real time a pass may take before a delay assertion is suspicious. */
const SLACK_MS = 2_000;

/** How long a held send takes, which every delay it schedules must clear. */
const HELD_SEND_MS = 300;

describe("the outbox worker", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let agent: string;
  let originalFetch: typeof globalThis.fetch;
  /** Text bodies that reached the network, in order. */
  let textSends: string[];
  /** Every send request body that reached the network, accepted or not. */
  let requests: Array<Record<string, any>>;
  let answer: () => Response;
  /** Runs before the network answers. A test holds a send here. */
  let beforeNetworkAnswers: () => Promise<void>;

  const accepted = () =>
    new Response(
      JSON.stringify({ messages: [{ id: `wamid-${textSends.length}` }] }),
      { headers: { "Content-Type": "application/json" } },
    );
  /** A 502 with an HTML body: the adapter classifies it `transient`. */
  const unreachable = () =>
    new Response("<html>Bad gateway</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });
  /** A reset connection: the adapter classifies it `ambiguous`. */
  const reset = (): Response => {
    throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
  };

  function rows(): OutboxRow[] {
    return db
      .prepare(
        `SELECT * FROM outbox
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
         ORDER BY id`,
      )
      .all(ref.tenantId, ref.channelAccountId, ref.phoneNumber) as OutboxRow[];
  }

  /**
   * A retry delay runs from the end of the attempt, so the stored time is the
   * delay plus however long the pass really took.
   */
  function expectDelay(
    nextAttemptAt: number,
    countedFrom: number,
    delay: number,
  ): void {
    expect(nextAttemptAt).toBeGreaterThanOrEqual(countedFrom + delay);
    expect(nextAttemptAt).toBeLessThan(countedFrom + delay + SLACK_MS);
  }

  function message(id: string): ConversationMessage {
    return db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as ConversationMessage;
  }

  /** Queue one reply by letting its inline send fail the way `answer` says. */
  async function queue(text: string): Promise<OutboxRow> {
    const before = rows().length;
    await WhatsAppService.sendMessage(ref, text, { retry: true });
    const queued = rows();
    expect(queued).toHaveLength(before + 1);
    return queued[before]!;
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("outbox-worker");
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

    textSends = [];
    requests = [];
    answer = accepted;
    beforeNetworkAnswers = async () => {};
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      requests.push(body);
      await beforeNetworkAnswers();
      const response = answer();
      if (response.ok && body.type === "text") textSends.push(body.text.body);
      return response;
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(async () => {
    await stopOutboxWorker();
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    db.prepare("DELETE FROM audit_log WHERE user_id = ?").run(agent);
    dropTenantFixture(tenant);
  });

  it("sends a due row and puts Meta's id on the message it already wrote", async () => {
    answer = unreachable;
    const row = await queue("hola");
    const queuedAt = message(row.message_id).created_at;
    answer = accepted;

    await processDueOutbox(row.next_attempt_at);

    expect(textSends).toEqual(["hola"]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      status: "sent",
      attempts: 2,
      last_kind: "accepted",
      last_reason: null,
    });
    expect(message(row.message_id)).toMatchObject({
      status: "sent",
      whatsapp_message_id: "wamid-0",
      // A late reply keeps its place in the thread.
      created_at: queuedAt,
    });
  });

  it("leaves a row alone before it is due", async () => {
    answer = unreachable;
    const row = await queue("hola");
    answer = accepted;

    await processDueOutbox(row.next_attempt_at - 1);

    expect(textSends).toEqual([]);
    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("retries a transient failure at 5 s, 30 s, 2 min and 10 min, then gives up", async () => {
    answer = unreachable;
    const row = await queue("hola");

    const schedule = [5_000, 30_000, 2 * 60_000, 10 * 60_000];
    let attemptEndedAt = row.created_at;

    for (const [index, delay] of schedule.entries()) {
      const waiting = rows()[0]!;
      expect(waiting).toMatchObject({
        status: "pending",
        attempts: index + 1,
      });
      expectDelay(waiting.next_attempt_at, attemptEndedAt, delay);

      attemptEndedAt = waiting.next_attempt_at;
      await processDueOutbox(waiting.next_attempt_at);
    }

    expect(rows()[0]).toMatchObject({
      status: "failed",
      attempts: 5,
      last_kind: "transient",
      last_reason: "exhausted",
    });
    expect(message(row.message_id).status).toBe("failed");
  });

  it("retries an ambiguous send once and then gives up, rather than risk a third delivery", async () => {
    answer = reset;
    const row = await queue("hola");

    expect(rows()[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      ambiguous_attempts: 1,
      next_attempt_at: row.created_at + 5_000,
    });

    await processDueOutbox(row.created_at + 5_000);

    expect(rows()[0]).toMatchObject({
      status: "failed",
      attempts: 2,
      ambiguous_attempts: 2,
      last_kind: "ambiguous",
      last_reason: "network:ECONNRESET",
    });
    expect(message(row.message_id).status).toBe("failed");
  });

  it("holds the rows behind the head, then sends them in order", async () => {
    answer = unreachable;
    const first = await queue("primero");
    await queue("segundo");
    answer = accepted;

    // The second row is due from the moment it was queued, and stays put.
    await processDueOutbox(first.created_at + 1_000);
    expect(textSends).toEqual([]);
    expect(rows().map((row) => row.status)).toEqual(["pending", "pending"]);

    await processDueOutbox(first.next_attempt_at);
    expect(textSends).toEqual(["primero"]);
    expect(rows().map((row) => row.status)).toEqual(["sent", "pending"]);

    await processDueOutbox(first.next_attempt_at);
    expect(textSends).toEqual(["primero", "segundo"]);
    expect(rows().map((row) => row.status)).toEqual(["sent", "sent"]);
  });

  it("gives up on a row an hour old without asking WhatsApp again", async () => {
    answer = unreachable;
    const row = await queue("hola");
    answer = accepted;

    await processDueOutbox(row.created_at + MAX_AGE_MS);

    expect(textSends).toEqual([]);
    expect(rows()[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      last_reason: "expired",
    });
    expect(message(row.message_id).status).toBe("failed");
  });

  it("expires a row of a number that stays switched off", async () => {
    answer = unreachable;
    const row = await queue("hola");
    ChannelAccountService.updateStatus(ref.channelAccountId, "disabled");
    answer = accepted;

    await processDueOutbox(row.next_attempt_at);
    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 1 });

    await processDueOutbox(row.created_at + MAX_AGE_MS);

    expect(textSends).toEqual([]);
    expect(rows()[0]).toMatchObject({
      status: "failed",
      last_reason: "expired",
    });
  });

  it("sends nothing for a suspended tenant and leaves the row pending", async () => {
    answer = unreachable;
    const row = await queue("hola");
    db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(
      tenant.tenantId,
    );
    answer = accepted;

    await processDueOutbox(row.next_attempt_at);
    await processDueOutbox(row.created_at + MAX_AGE_MS);

    expect(textSends).toEqual([]);
    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 1 });

    db.prepare("UPDATE tenants SET status = 'active' WHERE id = ?").run(
      tenant.tenantId,
    );
  });

  it("counts no attempt when the number is switched off between the poll and the send", async () => {
    answer = unreachable;
    const row = await queue("hola");
    answer = accepted;

    // The pass picks the conversation up synchronously and takes the lock a
    // microtask later, so the number goes off between the two.
    const pass = processDueOutbox(row.next_attempt_at);
    ChannelAccountService.updateStatus(ref.channelAccountId, "disabled");
    await pass;

    expect(textSends).toEqual([]);
    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 1 });
    expectDelay(rows()[0]!.next_attempt_at, row.next_attempt_at, 60_000);
    expect(message(row.message_id).status).toBe("queued");
  });

  it("records a row left sending by a dead process as one ambiguous attempt", async () => {
    answer = unreachable;
    const row = await queue("hola");
    db.prepare("UPDATE outbox SET status = 'sending' WHERE id = ?").run(row.id);

    startOutboxWorker();
    await stopOutboxWorker();

    expect(rows()[0]).toMatchObject({
      status: "pending",
      attempts: 2,
      ambiguous_attempts: 1,
      last_kind: "ambiguous",
      last_reason: "interrupted",
    });
    expect(message(row.message_id).status).toBe("queued");
  });

  it("waits for the pass in progress before it stops", async () => {
    answer = unreachable;
    const row = await queue("hola");
    db.prepare("UPDATE outbox SET next_attempt_at = ? WHERE id = ?").run(
      Date.now() - 1,
      row.id,
    );
    answer = accepted;

    let releaseNetwork!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseNetwork = resolve;
    });
    let sendReachedNetwork!: () => void;
    const reached = new Promise<void>((resolve) => {
      sendReachedNetwork = resolve;
    });
    beforeNetworkAnswers = async () => {
      sendReachedNetwork();
      await held;
    };

    startOutboxWorker();
    await reached;

    let stopped = false;
    const stopping = stopOutboxWorker().then(() => {
      stopped = true;
    });
    await Bun.sleep(50);
    expect(stopped).toBe(false);
    expect(rows()[0]!.status).toBe("sending");

    releaseNetwork();
    await stopping;

    expect(stopped).toBe(true);
    expect(rows()[0]).toMatchObject({ status: "sent" });
  });

  it("sends a row only once when two passes both found it due", async () => {
    answer = unreachable;
    const row = await queue("hola");
    requests.length = 0;

    let releaseFirstSend!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    let sendsReached = 0;
    beforeNetworkAnswers = async () => {
      sendsReached++;
      if (sendsReached === 1) await held;
    };

    // Both passes read the queue before either takes the lock, so both saw the
    // row pending and due. The second must find it rescheduled and leave it.
    const passes = Promise.all([
      processDueOutbox(row.next_attempt_at),
      processDueOutbox(row.next_attempt_at),
    ]);
    while (sendsReached === 0) await Bun.sleep(1);
    releaseFirstSend();
    await passes;

    expect(requests).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 2 });
    expectDelay(rows()[0]!.next_attempt_at, row.next_attempt_at, 30_000);
  });

  it("counts a transient retry from the end of a slow attempt, not the start of the pass", async () => {
    answer = unreachable;
    const row = await queue("hola");
    beforeNetworkAnswers = () => Bun.sleep(HELD_SEND_MS);

    await processDueOutbox(row.next_attempt_at);

    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 2 });
    expect(rows()[0]!.next_attempt_at).toBeGreaterThanOrEqual(
      row.next_attempt_at + HELD_SEND_MS + 30_000,
    );
  });

  it("keeps the whole 5 s after a slow ambiguous attempt, so the next poll does not resend at once", async () => {
    answer = unreachable;
    const row = await queue("hola");
    answer = reset;
    beforeNetworkAnswers = () => Bun.sleep(HELD_SEND_MS);

    const pollStartedAt = row.next_attempt_at;
    await processDueOutbox(pollStartedAt);

    expect(rows()[0]).toMatchObject({
      status: "pending",
      ambiguous_attempts: 1,
      last_reason: "network:ECONNRESET",
    });
    // An ambiguous send may already be on its way to the customer. The spacing
    // that keeps a duplicate apart is gone if the row is due the moment the
    // attempt ends.
    expect(rows()[0]!.next_attempt_at).toBeGreaterThan(pollStartedAt + 5_000);
    expect(rows()[0]!.next_attempt_at).toBeGreaterThanOrEqual(
      pollStartedAt + HELD_SEND_MS + 5_000,
    );
  });

  it("sends a queued image again with the caption it was queued with", async () => {
    answer = unreachable;
    await WhatsAppService.sendImage(
      ref,
      "images/img-dear.jpg",
      "Cocina 4 hornillas\nPrecio: S/ 1200.00",
      "bundle-1",
      { retry: true },
    );
    const row = rows()[0]!;
    requests.length = 0;
    answer = accepted;

    await processDueOutbox(row.next_attempt_at);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      type: "image",
      image: { caption: "Cocina 4 hornillas\nPrecio: S/ 1200.00" },
    });
    expect(rows()[0]!.status).toBe("sent");
  });

  it("treats a send that threw as ambiguous, so it is repeated at most once", async () => {
    answer = unreachable;
    const row = await queue("hola");

    const realSend = CloudApiAdapter.sendMessage;
    CloudApiAdapter.sendMessage = () => {
      throw new Error("the adapter itself broke");
    };
    try {
      await processDueOutbox(row.next_attempt_at);

      expect(rows()[0]).toMatchObject({
        status: "pending",
        attempts: 2,
        ambiguous_attempts: 1,
        last_kind: "ambiguous",
        last_reason: "send_threw",
      });
      expectDelay(rows()[0]!.next_attempt_at, row.next_attempt_at, 5_000);

      await processDueOutbox(rows()[0]!.next_attempt_at);

      expect(rows()[0]).toMatchObject({
        status: "failed",
        attempts: 3,
        ambiguous_attempts: 2,
        last_reason: "send_threw",
      });
    } finally {
      CloudApiAdapter.sendMessage = realSend;
    }
    expect(message(rows()[0]!.message_id).status).toBe("failed");
  });

  it("refuses to claim a row that is no longer pending, and changes nothing", async () => {
    answer = unreachable;
    const row = await queue("hola");
    await takeoverConversation(ref, agent);
    const cancelled = rows()[0]!;

    // `row` is the stale copy a pass read before the takeover landed.
    expect(claimRow(row, Date.now())).toBeUndefined();

    expect(rows()[0]).toEqual(cancelled);
  });

  describe("when a person takes the conversation over", () => {
    it("cancels the replies the bot still owed, and the worker sends none of them", async () => {
      answer = unreachable;
      const first = await queue("primero");
      await queue("segundo");
      answer = accepted;

      await takeoverConversation(ref, agent);

      expect(rows().map((row) => row.status)).toEqual([
        "cancelled",
        "cancelled",
      ]);
      expect(rows().map((row) => message(row.message_id).status)).toEqual([
        "cancelled",
        "cancelled",
      ]);

      await processDueOutbox(first.next_attempt_at);

      expect(textSends).toEqual([]);
    });

    it("records how many replies it dropped on the audit row", async () => {
      answer = unreachable;
      await queue("primero");
      await queue("segundo");

      await takeoverConversation(ref, agent);

      const audit = db
        .prepare(
          "SELECT metadata FROM audit_log WHERE tenant_id = ? AND action = 'takeover'",
        )
        .get(tenant.tenantId) as { metadata: string };
      expect(JSON.parse(audit.metadata)).toEqual({ cancelledReplies: 2 });
    });

    it("leaves a row the worker already sent alone", async () => {
      answer = unreachable;
      const row = await queue("hola");
      answer = accepted;
      await processDueOutbox(row.next_attempt_at);

      await takeoverConversation(ref, agent);

      expect(rows()[0]!.status).toBe("sent");
      expect(message(row.message_id).status).toBe("sent");
    });
  });

  describe("the retention purge", () => {
    it("deletes rows a week after they finished, and keeps the rest", async () => {
      answer = unreachable;
      const stale = await queue("viejo");
      const waiting = await queue("nuevo");
      db.prepare(
        "UPDATE outbox SET status = 'failed', updated_at = ? WHERE id = ?",
      ).run(Date.now() - OUTBOX_RETENTION_MS - 1, stale.id);

      expect(purgeFinishedOutbox()).toBe(1);

      expect(rows().map((row) => row.id)).toEqual([waiting.id]);
    });

    it("keeps a row that finished inside the window", async () => {
      answer = unreachable;
      const row = await queue("hola");
      db.prepare(
        "UPDATE outbox SET status = 'sent', updated_at = ? WHERE id = ?",
      ).run(Date.now() - OUTBOX_RETENTION_MS + 60_000, row.id);

      expect(purgeFinishedOutbox()).toBe(0);
      expect(rows()).toHaveLength(1);
    });
  });

  describe("when the bot escalates", () => {
    const metadata = {
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    } as ConversationMetadata;

    const escalating = {
      type: "update" as const,
      nextPhase: {
        phase: "escalated",
        reason: "multiple_objections",
      } as ConversationPhase,
      commands: [
        {
          type: "SEND_MESSAGE" as const,
          text: "Un asesor te contactará en breve",
        },
      ],
    };

    it("keeps the advisor message queued, because nobody took the conversation over", async () => {
      answer = unreachable;

      await executeCommands(escalating, ref, metadata, false, "trace");

      const queued = rows();
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        status: "pending",
        content: "Un asesor te contactará en breve",
      });

      answer = accepted;
      await processDueOutbox(queued[0]!.next_attempt_at);

      expect(textSends).toEqual(["Un asesor te contactará en breve"]);
      expect(rows()[0]!.status).toBe("sent");
    });
  });
});

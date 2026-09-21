/**
 * The conversation lock: one operation per conversation at a time, for as long
 * as that operation is actually running.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import process from "node:process";
import type { ConversationRef } from "@vendeya/types";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";
import { TIMEOUTS } from "../src/config/timeouts.ts";
import {
  processGroup,
  processReadyMessages,
} from "../src/conversation/aggregator-worker.ts";
import {
  type AggregatedGroup,
  getReadyForAggregation,
} from "../src/conversation/message-inbox.ts";
import { processHeldMessages } from "../src/conversation/process-held.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import {
  acquireLock,
  ConversationBusyError,
  LockTimeoutError,
  withLock,
} from "../src/conversation/locks.ts";

function conversation(): ConversationRef {
  return {
    tenantId: `tn-${crypto.randomUUID()}`,
    channelAccountId: `ch-${crypto.randomUUID()}`,
    phoneNumber: "51900777888",
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An `fn` for `withLock` that stays unresolved until `finish` is called. */
function pending() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { run: () => promise, finish };
}

describe("conversation lock", () => {
  it("lets one of two queued callers in at a time once the holder releases", async () => {
    const ref = conversation();
    const releaseHolder = await acquireLock(ref);

    let inside = 0;
    let mostInside = 0;

    const waiter = async () => {
      const release = await acquireLock(ref);
      inside++;
      mostInside = Math.max(mostInside, inside);
      await pause(10);
      inside--;
      release();
    };

    // Both queue behind the holder before it lets go.
    const waiters = Promise.all([waiter(), waiter()]);
    releaseHolder();
    await waiters;

    expect(mostInside).toBe(1);
  });

  it("keeps the next caller out while a timed-out operation is still running", async () => {
    const ref = conversation();
    const slow = pending();

    await expect(withLock(ref, slow.run, 20)).rejects.toThrow(LockTimeoutError);

    let nextStarted = false;
    const next = withLock(ref, async () => {
      nextStarted = true;
    });

    await pause(50);
    expect(nextStarted).toBe(false);

    slow.finish();
    await next;
    expect(nextStarted).toBe(true);
  });

  it("answers a queued caller on time, and never runs what it gave up on", async () => {
    const ref = conversation();
    const slow = pending();
    const holder = withLock(ref, slow.run);

    let abandonedRan = false;
    await expect(
      withLock(
        ref,
        async () => {
          abandonedRan = true;
        },
        20,
      ),
    ).rejects.toThrow(ConversationBusyError);

    slow.finish();
    await holder;

    let laterRan = false;
    await withLock(ref, async () => {
      laterRan = true;
    });

    expect(abandonedRan).toBe(false);
    expect(laterRan).toBe(true);
  });

  it("releases the conversation when the operation throws", async () => {
    const ref = conversation();

    await expect(
      withLock(ref, async () => {
        throw new Error("send failed");
      }),
    ).rejects.toThrow("send failed");

    expect(await withLock(ref, async () => "next")).toBe("next");
  });
});

describe("a queued group whose conversation is still busy", () => {
  const CUSTOMER = "51900777999";
  const lockTimeouts = TIMEOUTS as { LOCK_DEFAULT: number };

  let savedKey: string | undefined;
  let savedLockTimeout: number;
  let originalFetch: typeof globalThis.fetch;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let sends: number;

  function queueStatuses(): string[] {
    return (
      db
        .prepare(
          "SELECT status FROM message_inbox WHERE channel_account_id = ? ORDER BY id",
        )
        .all(ref.channelAccountId) as Array<{ status: string }>
    ).map((row) => row.status);
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "f6".repeat(32);
    savedLockTimeout = lockTimeouts.LOCK_DEFAULT;

    applySchema();
    tenant = createTenantFixture("busy-conversation");
    const account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: `pnid-${crypto.randomUUID().slice(0, 8)}`,
      accessToken: "EAAG-a-real-looking-token",
    });
    ref = {
      tenantId: tenant.tenantId,
      channelAccountId: account.id,
      phoneNumber: CUSTOMER,
    };

    db.prepare(
      `INSERT INTO message_inbox
         (tenant_id, channel_account_id, phone_number, message_text, message_id,
          whatsapp_timestamp, status, created_at)
       VALUES (?, ?, ?, 'hola', ?, 1, 'pending', ?)`,
    ).run(
      ref.tenantId,
      ref.channelAccountId,
      CUSTOMER,
      `wamid-${crypto.randomUUID()}`,
      Date.now() - 60_000,
    );

    sends = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      sends++;
      return new Response(
        JSON.stringify({ messages: [{ id: `wamid-out-${sends}` }] }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    lockTimeouts.LOCK_DEFAULT = savedLockTimeout;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  it("goes back on the queue untouched, and is answered once the conversation is free", async () => {
    const group = getReadyForAggregation(0).find(
      (g) => g.channel_account_id === ref.channelAccountId,
    );
    if (!group) throw new Error("The queued message was not dequeued");

    const releaseEarlier = await acquireLock(ref);
    lockTimeouts.LOCK_DEFAULT = 20;

    await processGroup(group);

    expect(queueStatuses()).toEqual(["pending"]);
    expect(sends).toBe(0);

    releaseEarlier();
    lockTimeouts.LOCK_DEFAULT = savedLockTimeout;
    await processReadyMessages();

    expect(queueStatuses()).toEqual(["processed"]);
    expect(sends).toBeGreaterThan(0);
  });
});

describe("the operation a lock timeout leaves running", () => {
  it("is handed to the caller, and settles with the operation's result", async () => {
    const slow = pending();
    const error = await withLock(conversation(), slow.run, 20).catch(
      (thrown: unknown) => thrown,
    );

    if (!(error instanceof LockTimeoutError)) {
      throw new Error("Expected the lock to time out");
    }

    let settled = false;
    const operation = error.operation.then(() => {
      settled = true;
    });

    await pause(20);
    expect(settled).toBe(false);

    slow.finish();
    await operation;
    expect(settled).toBe(true);
  });

  it("settles with the operation's error when it fails after the timeout", async () => {
    const slow = pending();
    const error = await withLock(
      conversation(),
      async () => {
        await slow.run();
        throw new Error("send failed late");
      },
      20,
    ).catch((thrown: unknown) => thrown);

    if (!(error instanceof LockTimeoutError)) {
      throw new Error("Expected the lock to time out");
    }

    slow.finish();
    await expect(error.operation).rejects.toThrow("send failed late");
  });
});

/**
 * Both queues hand a batch to `handleMessage`, which answers under the
 * conversation lock. A lock timeout leaves that answer running with an unknown
 * outcome, a reply or a refusal. The queue's record of the batch must wait for
 * it, or the message ends up never answered or answered twice.
 */
describe("an answer still running when its lock times out", () => {
  const CUSTOMER = "51900777555";
  const lockTimeouts = TIMEOUTS as { LOCK_DEFAULT: number };

  let savedKey: string | undefined;
  let savedLockTimeout: number;
  let originalFetch: typeof globalThis.fetch;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let readReceipts: number;
  let receiptGate: Promise<void>;

  /**
   * Holds every answer at its read receipt until the returned function is
   * called. Each answer sends exactly one receipt first, so the receipts count
   * how many times a batch was answered.
   */
  function holdAnswers(): () => void {
    let letThrough!: () => void;
    receiptGate = new Promise((resolve) => {
      letThrough = resolve;
    });
    return letThrough;
  }

  async function eventually(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error("The timed-out answer never settled");
      }
      await pause(10);
    }
  }

  function queueStatuses(): string[] {
    return (
      db
        .prepare(
          "SELECT status FROM message_inbox WHERE channel_account_id = ? ORDER BY id",
        )
        .all(ref.channelAccountId) as Array<{ status: string }>
    ).map((row) => row.status);
  }

  function unansweredHeld(): number {
    return (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM held_messages WHERE channel_account_id = ? AND processed_at IS NULL",
        )
        .get(ref.channelAccountId) as { c: number }
    ).c;
  }

  function queue(): AggregatedGroup {
    db.prepare(
      `INSERT INTO message_inbox
         (tenant_id, channel_account_id, phone_number, message_text, message_id,
          whatsapp_timestamp, status, created_at)
       VALUES (?, ?, ?, 'hola', ?, 1, 'pending', ?)`,
    ).run(
      ref.tenantId,
      ref.channelAccountId,
      CUSTOMER,
      `wamid-${crypto.randomUUID()}`,
      Date.now() - 60_000,
    );
    const group = getReadyForAggregation(0).find(
      (g) => g.channel_account_id === ref.channelAccountId,
    );
    if (!group) throw new Error("The queued message was not dequeued");
    return group;
  }

  function hold(): void {
    db.prepare(
      `INSERT INTO held_messages
         (tenant_id, channel_account_id, phone_number, message_text, message_id, whatsapp_timestamp)
       VALUES (?, ?, ?, 'hola', ?, 1)`,
    ).run(
      ref.tenantId,
      ref.channelAccountId,
      CUSTOMER,
      `wamid-${crypto.randomUUID()}`,
    );
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e7".repeat(32);
    savedLockTimeout = lockTimeouts.LOCK_DEFAULT;

    applySchema();
    tenant = createTenantFixture("late-answer");
    const account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: `pnid-${crypto.randomUUID().slice(0, 8)}`,
      accessToken: "EAAG-a-real-looking-token",
    });
    ref = {
      tenantId: tenant.tenantId,
      channelAccountId: account.id,
      phoneNumber: CUSTOMER,
    };

    readReceipts = 0;
    receiptGate = Promise.resolve();
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes('"status":"read"')) {
        readReceipts++;
        await receiptGate;
      }
      return new Response(
        JSON.stringify({
          messages: [{ id: `wamid-out-${crypto.randomUUID()}` }],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    lockTimeouts.LOCK_DEFAULT = savedLockTimeout;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  describe("taken off the inbox queue", () => {
    it("stays processing while the answer runs, and is marked processed once it finishes", async () => {
      const group = queue();
      const letThrough = holdAnswers();
      lockTimeouts.LOCK_DEFAULT = 20;

      await processGroup(group);
      expect(readReceipts).toBe(1);

      // In flight: not handed back to the queue, where the next poll would
      // answer it a second time.
      expect(queueStatuses()).toEqual(["processing"]);
      await processReadyMessages();
      expect(readReceipts).toBe(1);

      letThrough();
      await eventually(() => queueStatuses()[0] !== "processing");

      expect(queueStatuses()).toEqual(["processed"]);
      await processReadyMessages();
      expect(readReceipts).toBe(1);
    });

    it("goes back on the queue when the late answer is refused, and is answered once the number returns", async () => {
      const group = queue();
      const letThrough = holdAnswers();
      lockTimeouts.LOCK_DEFAULT = 20;

      await processGroup(group);
      ChannelAccountService.updateStatus(ref.channelAccountId, "disabled");

      letThrough();
      await eventually(() => queueStatuses()[0] !== "processing");

      expect(queueStatuses()).toEqual(["pending"]);

      ChannelAccountService.updateStatus(ref.channelAccountId, "active");
      lockTimeouts.LOCK_DEFAULT = savedLockTimeout;
      await processReadyMessages();

      expect(queueStatuses()).toEqual(["processed"]);
      expect(readReceipts).toBe(2);
    });
  });

  describe("held through maintenance", () => {
    it("is marked answered once the late answer finishes, and a later sweep does not answer it again", async () => {
      hold();
      const letThrough = holdAnswers();
      lockTimeouts.LOCK_DEFAULT = 20;

      const run = await processHeldMessages(ref.tenantId);
      expect(readReceipts).toBe(1);
      expect(run.byTenant[ref.tenantId]).toEqual({
        usersProcessed: 0,
        messagesProcessed: 0,
        errors: 0,
        stillAnswering: 1,
      });

      letThrough();
      await eventually(() => unansweredHeld() === 0);

      const later = await processHeldMessages(ref.tenantId);
      expect(later.usersProcessed).toBe(0);
      expect(readReceipts).toBe(1);
    });

    it("is not answered by a sweep that starts while the first answer is still running", async () => {
      hold();
      const letThrough = holdAnswers();
      lockTimeouts.LOCK_DEFAULT = 20;

      await processHeldMessages(ref.tenantId);
      expect(readReceipts).toBe(1);

      // A second sweep patient enough to outlast the first answer: queued
      // behind it on the lock, it would answer the same group right after.
      lockTimeouts.LOCK_DEFAULT = savedLockTimeout;
      const second = processHeldMessages(ref.tenantId);
      await pause(50);

      letThrough();
      const run = await second;
      await eventually(() => unansweredHeld() === 0);

      expect(run.usersProcessed).toBe(0);
      expect(readReceipts).toBe(1);
    });

    it("stays held when the late answer is refused, and is answered by the sweep after the number returns", async () => {
      hold();
      const letThrough = holdAnswers();
      lockTimeouts.LOCK_DEFAULT = 20;

      await processHeldMessages(ref.tenantId);
      ChannelAccountService.updateStatus(ref.channelAccountId, "disabled");

      letThrough();
      // The late refusal changes nothing observable in the table, because the
      // row stays unanswered either way. Wait for the lock to come free instead.
      await withLock(ref, async () => {}, 10_000);
      await pause(10);
      expect(unansweredHeld()).toBe(1);

      ChannelAccountService.updateStatus(ref.channelAccountId, "active");
      lockTimeouts.LOCK_DEFAULT = savedLockTimeout;
      const run = await processHeldMessages(ref.tenantId);

      expect(run.messagesProcessed).toBe(1);
      expect(unansweredHeld()).toBe(0);
      expect(readReceipts).toBe(2);
    });
  });
});

describe("a group whose answer fails outright", () => {
  let tenant: TenantFixture;
  let originalFetch: typeof globalThis.fetch;

  /** A conversation row the handler cannot read: it throws before replying. */
  function unreadableConversation(ref: ConversationRef): void {
    db.prepare(
      `INSERT INTO conversations (tenant_id, channel_account_id, phone_number, context_data, status)
       VALUES (?, ?, ?, 'null', 'active')`,
    ).run(ref.tenantId, ref.channelAccountId, ref.phoneNumber);
  }

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("failed-answer");
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("{}", {
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    dropTenantFixture(tenant);
  });

  it("is marked failed with the reason when queued, not stranded in 'processing'", async () => {
    const ref = tenant.ref("51900777666");
    unreadableConversation(ref);
    db.prepare(
      `INSERT INTO message_inbox
         (tenant_id, channel_account_id, phone_number, message_text, message_id,
          whatsapp_timestamp, status, created_at)
       VALUES (?, ?, ?, 'hola', ?, 1, 'pending', ?)`,
    ).run(
      ref.tenantId,
      ref.channelAccountId,
      ref.phoneNumber,
      `wamid-${crypto.randomUUID()}`,
      Date.now() - 60_000,
    );

    const group = getReadyForAggregation(0).find(
      (g) => g.channel_account_id === ref.channelAccountId,
    );
    if (!group) throw new Error("The queued message was not dequeued");

    await processGroup(group);

    const row = db
      .prepare(
        "SELECT status, attempts, last_error FROM message_inbox WHERE channel_account_id = ?",
      )
      .get(ref.channelAccountId) as {
      status: string;
      attempts: number;
      last_error: string | null;
    };
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain("phase");
  });

  it("is left held for the next sweep when held", async () => {
    const ref = tenant.ref("51900777667");
    unreadableConversation(ref);
    db.prepare(
      `INSERT INTO held_messages
         (tenant_id, channel_account_id, phone_number, message_text, message_id, whatsapp_timestamp)
       VALUES (?, ?, ?, 'hola', ?, 1)`,
    ).run(
      ref.tenantId,
      ref.channelAccountId,
      ref.phoneNumber,
      `wamid-${crypto.randomUUID()}`,
    );

    const failed = await processHeldMessages(ref.tenantId);
    expect(failed.errors).toBe(1);

    db.prepare(
      "DELETE FROM conversations WHERE channel_account_id = ? AND phone_number = ?",
    ).run(ref.channelAccountId, ref.phoneNumber);
    const retried = await processHeldMessages(ref.tenantId);

    expect(retried.messagesProcessed).toBe(1);
  });
});

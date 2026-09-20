/**
 * Messages already queued or held for a number that is switched off must stay
 * where they are: a queued row stays `pending` and a held row stays held. A
 * refused send that only recorded a failure would let the worker mark the row
 * processed, leaving nothing to recover once the number is on.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { db } from "../src/db/index.ts";
import {
  addChannelAccount,
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import {
  getReadyForAggregation,
  markAsProcessing,
} from "../src/conversation/message-inbox.ts";
import {
  processGroup,
  processReadyMessages,
} from "../src/conversation/aggregator-worker.ts";
import { getAggregatedHeldMessages } from "../src/conversation/held-messages.ts";
import { checkAndReassignTimeouts } from "../src/domains/conversations/assignment.ts";
import { processHeldMessages } from "../src/conversation/process-held.ts";
import { handleMessage } from "../src/conversation/handler/index.ts";
import {
  ChannelUnavailableError,
  WhatsAppService,
} from "../src/adapters/whatsapp/index.ts";
import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import type { ChannelAccount, ConversationRef } from "@totem/types";

const CUSTOMER = "51900444555";

/** Old enough that the aggregator's quiet window has long since passed. */
const QUEUED_AT = () => Date.now() - 60_000;

describe("a channel account that is not active", () => {
  let tenant: TenantFixture;
  /** A second number for the same business, left on throughout. */
  let untouched: ReturnType<typeof addChannelAccount>;
  let sends: number;
  let originalFetch: typeof globalThis.fetch;

  function setStatus(
    channelAccountId: string,
    status: ChannelAccount["status"],
  ): void {
    ChannelAccountService.updateStatus(channelAccountId, status);
  }

  function queue(ref: ConversationRef, text: string): void {
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
      QUEUED_AT(),
    );
  }

  function hold(ref: ConversationRef, text: string): void {
    db.prepare(
      `INSERT INTO held_messages
         (tenant_id, channel_account_id, phone_number, message_text, message_id, whatsapp_timestamp)
       VALUES (?, ?, ?, ?, ?, 1)`,
    ).run(
      ref.tenantId,
      ref.channelAccountId,
      ref.phoneNumber,
      text,
      `wamid-${crypto.randomUUID()}`,
    );
  }

  /** Every inbox row for one number, by status. */
  function queueStatuses(channelAccountId: string): string[] {
    return (
      db
        .prepare(
          "SELECT status FROM message_inbox WHERE channel_account_id = ? ORDER BY id",
        )
        .all(channelAccountId) as Array<{ status: string }>
    ).map((row) => row.status);
  }

  function heldCount(channelAccountId: string): number {
    return (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM held_messages WHERE channel_account_id = ? AND processed_at IS NULL",
        )
        .get(channelAccountId) as { c: number }
    ).c;
  }

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("channel-off");
    untouched = addChannelAccount(tenant);

    // Tests here must not reach Meta or the notifier. The fake fetch counts
    // sends so that a send that got out fails the test.
    sends = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      sends++;
      return new Response(JSON.stringify({ error: "no network in tests" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    dropTenantFixture(tenant);
  });

  for (const status of ["disabled", "pending"] as const) {
    describe(`(${status}) is left out of the aggregator's dequeue`, () => {
      it("while the business's other number is still served", () => {
        queue(tenant.ref(CUSTOMER), "hola");
        queue(untouched.ref(CUSTOMER), "hola");

        const before = getReadyForAggregation(0).map(
          (g) => g.channel_account_id,
        );
        expect(before).toContain(tenant.channelAccountId);
        expect(before).toContain(untouched.channelAccountId);

        setStatus(tenant.channelAccountId, status);

        const after = getReadyForAggregation(0).map(
          (g) => g.channel_account_id,
        );
        expect(after).not.toContain(tenant.channelAccountId);
        expect(after).toContain(untouched.channelAccountId);
      });
    });

    describe(`(${status}) is left out of timeout reassignment`, () => {
      /** A conversation whose agent was paged and never answered. */
      function abandoned(
        ref: ConversationRef,
        agentId: string,
        notifiedAt: number,
      ): void {
        insertConversation(ref, {
          status: "human_takeover",
          assignedAgent: agentId,
        });
        db.prepare(
          `UPDATE conversations SET assignment_notified_at = ?
           WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
        ).run(notifiedAt, ref.tenantId, ref.channelAccountId, ref.phoneNumber);
      }

      function notifiedAt(channelAccountId: string): number | null {
        return (
          db
            .prepare(
              "SELECT assignment_notified_at FROM conversations WHERE channel_account_id = ?",
            )
            .get(channelAccountId) as { assignment_notified_at: number | null }
        ).assignment_notified_at;
      }

      it("while the business's other number is still reassigned", () => {
        const agent = createMember(tenant, "sales_agent");
        const stale = Date.now() - 10 * 60 * 1000;
        abandoned(tenant.ref(CUSTOMER), agent.userId, stale);
        abandoned(untouched.ref(CUSTOMER), agent.userId, stale);

        setStatus(tenant.channelAccountId, status);

        checkAndReassignTimeouts();

        expect(notifiedAt(tenant.channelAccountId)).toBe(stale);
        expect(notifiedAt(untouched.channelAccountId)).toBeGreaterThan(stale);
      });
    });

    describe(`(${status}) is left out of the held-message sweep`, () => {
      it("while the business's other number is still swept", () => {
        hold(tenant.ref(CUSTOMER), "retenido");
        hold(untouched.ref(CUSTOMER), "retenido");

        setStatus(tenant.channelAccountId, status);

        const groups = getAggregatedHeldMessages(tenant.tenantId).map(
          (g) => g.channel_account_id,
        );
        expect(groups).not.toContain(tenant.channelAccountId);
        expect(groups).toContain(untouched.channelAccountId);
      });
    });
  }

  describe("running the aggregator over a message queued for it", () => {
    beforeEach(() => {
      insertConversation(tenant.ref(CUSTOMER));
      queue(tenant.ref(CUSTOMER), "¿sigue disponible?");
      setStatus(tenant.channelAccountId, "disabled");
    });

    it("leaves the message on the queue instead of dropping it", async () => {
      await processReadyMessages();

      // The row must stay 'pending'. It is the only record that this reply is
      // owed.
      expect(queueStatuses(tenant.channelAccountId)).toEqual(["pending"]);
      expect(sends).toBe(0);
    });

    it("answers it once the number is switched back on", async () => {
      await processReadyMessages();
      expect(queueStatuses(tenant.channelAccountId)).toEqual(["pending"]);

      setStatus(tenant.channelAccountId, "active");

      await processReadyMessages();

      expect(queueStatuses(tenant.channelAccountId)).toEqual(["processed"]);
    });
  });

  describe("running the held-message sweep over a message held for it", () => {
    beforeEach(() => {
      insertConversation(tenant.ref(CUSTOMER));
      hold(tenant.ref(CUSTOMER), "¿sigue disponible?");
      setStatus(tenant.channelAccountId, "disabled");
    });

    it("leaves the message held instead of clearing it", async () => {
      const run = await processHeldMessages(tenant.tenantId);

      expect(run.messagesProcessed).toBe(0);
      expect(heldCount(tenant.channelAccountId)).toBe(1);
      expect(sends).toBe(0);
    });

    it("answers it once the number is switched back on", async () => {
      await processHeldMessages(tenant.tenantId);
      expect(heldCount(tenant.channelAccountId)).toBe(1);

      setStatus(tenant.channelAccountId, "active");

      const run = await processHeldMessages(tenant.tenantId);

      expect(run.messagesProcessed).toBe(1);
      expect(heldCount(tenant.channelAccountId)).toBe(0);
    });
  });

  /**
   * The dequeue filter cannot cover a number switched off after its batch was
   * taken off the queue. The worker must see the refusal as a thrown error,
   * because a recorded failure alone would let it mark the row processed.
   */
  describe("switched off after its messages were already dequeued", () => {
    it("refuses the send by throwing rather than recording a quiet failure", async () => {
      const ref = tenant.ref(CUSTOMER);
      insertConversation(ref);
      setStatus(tenant.channelAccountId, "disabled");

      await expect(
        WhatsAppService.sendMessage(ref, "¿Sigue ahí?"),
      ).rejects.toThrow(ChannelUnavailableError);

      expect(MessageStore.getHistory(ref)[0]).toMatchObject({
        direction: "outbound",
        status: "failed",
      });
      expect(sends).toBe(0);
    });

    it("is passed on by the handler rather than absorbed as a processing error", async () => {
      const ref = tenant.ref(CUSTOMER);
      insertConversation(ref);
      setStatus(tenant.channelAccountId, "disabled");

      // `handleMessage` absorbs other processing errors after logging them. It
      // must rethrow this one so the worker sees the refusal.
      await expect(
        handleMessage({
          ref,
          content: "hola",
          timestamp: Date.now(),
          messageId: "wamid-race",
        }),
      ).rejects.toThrow(ChannelUnavailableError);
    });

    it("puts the batch back on the queue instead of consuming it", async () => {
      const ref = tenant.ref(CUSTOMER);
      insertConversation(ref);
      queue(ref, "¿sigue disponible?");

      // Dequeued while the number was still on, switched off before the reply.
      const [group] = getReadyForAggregation(0);
      expect(group).toBeDefined();

      setStatus(tenant.channelAccountId, "disabled");

      await processGroup(group!);

      expect(queueStatuses(tenant.channelAccountId)).toEqual(["pending"]);
      expect(sends).toBe(0);

      // And it is genuinely back in circulation, not merely un-processed.
      setStatus(tenant.channelAccountId, "active");
      expect(
        getReadyForAggregation(0).map((g) => g.channel_account_id),
      ).toContain(tenant.channelAccountId);
    });

    /**
     * Only the worker moves a group out of `processing`. A batch it leaves there
     * is invisible to every later dequeue and to the pending count.
     */
    it("does not leave the batch stranded in 'processing'", async () => {
      const ref = tenant.ref(CUSTOMER);
      insertConversation(ref);
      queue(ref, "¿sigue disponible?");

      const [group] = getReadyForAggregation(0);
      markAsProcessing(group!.ids);
      setStatus(tenant.channelAccountId, "disabled");

      await processGroup(group!);

      expect(queueStatuses(tenant.channelAccountId)).not.toContain(
        "processing",
      );
    });
  });
});

/**
 * The sweep reads every held group up front and answers them one at a time, so
 * a number switched off mid-sweep has groups that were read while it was on.
 */
describe("switched off while a held-message sweep is already running", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let sendable: ChannelAccount;
  let switchedOff: ReturnType<typeof addChannelAccount>;
  let sends: number;
  /** The numbers the business switches off from inside the first send. */
  let switchOffOnSend: string[];
  let originalFetch: typeof globalThis.fetch;

  const FIRST = "51900444001";
  const SECOND = "51900444002";

  function hold(ref: ConversationRef, createdAt: number): void {
    db.prepare(
      `INSERT INTO held_messages
         (tenant_id, channel_account_id, phone_number, message_text, message_id,
          whatsapp_timestamp, created_at)
       VALUES (?, ?, ?, 'hola', ?, 1, ?)`,
    ).run(
      ref.tenantId,
      ref.channelAccountId,
      ref.phoneNumber,
      `wamid-${crypto.randomUUID()}`,
      createdAt,
    );
  }

  function heldFor(channelAccountId: string): number {
    return (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM held_messages WHERE channel_account_id = ? AND processed_at IS NULL",
        )
        .get(channelAccountId) as { c: number }
    ).c;
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "d4".repeat(32);

    applySchema();
    tenant = createTenantFixture("channel-off-midsweep");

    // A number that can genuinely send: active, and with a token behind it.
    sendable = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: `pnid-${crypto.randomUUID().slice(0, 8)}`,
      accessToken: "EAAG-a-real-looking-token",
    });
    switchedOff = addChannelAccount(tenant);

    const first: ConversationRef = {
      tenantId: tenant.tenantId,
      channelAccountId: sendable.id,
      phoneNumber: FIRST,
    };
    insertConversation(first);
    insertConversation(switchedOff.ref(SECOND));

    // Oldest first, so the sweep reaches the sending number before the other.
    hold(first, 1);
    hold(switchedOff.ref(SECOND), 2);

    sends = 0;
    switchOffOnSend = [switchedOff.channelAccountId];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      sends++;
      // The business switches its second number off, with the sweep already
      // holding a group that was read while it was on.
      for (const channelAccountId of switchOffOnSend) {
        ChannelAccountService.updateStatus(channelAccountId, "disabled");
      }
      return new Response(
        JSON.stringify({ messages: [{ id: "wamid-sent" }] }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  it("leaves that number's messages held instead of clearing them", async () => {
    const run = await processHeldMessages(tenant.tenantId);

    // The first number was answered and its messages cleared, as always.
    expect(sends).toBeGreaterThan(0);
    expect(run.usersProcessed).toBe(1);
    expect(heldFor(sendable.id)).toBe(0);

    // The second was not, and its messages are still there to answer later.
    expect(heldFor(switchedOff.channelAccountId)).toBe(1);

    // The skip is deliberate, as for a tenant that froze itself, so it is not
    // counted as an error.
    expect(run.errors).toBe(0);
  });

  it("answers those messages on the first sweep after the number is back", async () => {
    await processHeldMessages(tenant.tenantId);
    expect(heldFor(switchedOff.channelAccountId)).toBe(1);

    switchOffOnSend = [];
    ChannelAccountService.updateStatus(switchedOff.channelAccountId, "active");
    await processHeldMessages(tenant.tenantId);

    expect(heldFor(switchedOff.channelAccountId)).toBe(0);
  });

  /**
   * The operations route writes one audit row per `byTenant` entry. A business
   * whose only held group was skipped must have no entry, or the audit row
   * would claim a platform-wide sweep acted in a tenant it never touched.
   */
  it("records no sweep in a business whose only held messages were skipped", async () => {
    const other = createTenantFixture("channel-off-other-business");

    try {
      insertConversation(other.ref(SECOND));
      hold(other.ref(SECOND), 3);
      switchOffOnSend.push(other.channelAccountId);

      const run = await processHeldMessages(null);

      expect(Object.keys(run.byTenant)).toContain(tenant.tenantId);
      expect(Object.keys(run.byTenant)).not.toContain(other.tenantId);
      expect(heldFor(other.channelAccountId)).toBe(1);
    } finally {
      dropTenantFixture(other);
    }
  });
});

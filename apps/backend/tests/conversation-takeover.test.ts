/**
 * A person's takeover stops the bot, and releasing the conversation hands it
 * back. Every test runs the real path: the webhook stores the inbound message,
 * the aggregator worker answers it, and the only fake is the network.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import process from "node:process";
import { Hono } from "hono";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";
import { customerWrites as writeIn } from "./helpers/turn.ts";

import type { ConversationPhase } from "@vendeya/core";
import type { ConversationRef } from "@vendeya/types";

import { TIMEOUTS } from "../src/config/timeouts.ts";
import { processReadyMessages } from "../src/conversation/aggregator-worker.ts";
import {
  ConversationBusyError,
  acquireLock,
} from "../src/conversation/locks.ts";
import { holdMessage } from "../src/conversation/held-messages.ts";
import { processHeldMessages } from "../src/conversation/process-held.ts";
import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import {
  releaseConversation,
  sendManualMessage,
  takeoverConversation,
} from "../src/domains/conversations/write.ts";
import { requireAuth } from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import conversationRoutes from "../src/routes/conversations.ts";

const CUSTOMER = "51900555001";
const HOUR = 60 * 60 * 1000;

const OFFERING: ConversationPhase = {
  phase: "offering_products",
  segment: "fnb",
  credit: 5000,
  name: "Juan",
};

describe("a person takes over a conversation", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let agent: string;
  let originalFetch: typeof globalThis.fetch;
  /** Text messages that reached the network. Read receipts are not counted. */
  let textSends: string[];
  /** Runs before the network answers. A test holds a bot turn here. */
  let beforeNetworkAnswers: () => Promise<void>;
  let lockTimeout: { LOCK_DEFAULT: number };
  let savedLockTimeout: number;

  function insert(
    phase: ConversationPhase,
    options: {
      status?: string;
      handoverReason?: string | null;
      lastActivityAt?: number;
      metadata?: Record<string, unknown>;
      columns?: { client_name?: string; dni?: string; credit_line?: number };
    } = {},
  ): void {
    const now = Date.now();
    insertConversation(ref, {
      status: options.status,
      contextData: {
        phase,
        metadata: {
          createdAt: now,
          lastActivityAt: options.lastActivityAt ?? now,
          ...options.metadata,
        },
      },
    });
    db.prepare(
      `UPDATE conversations
       SET handover_reason = ?, client_name = ?, dni = ?, credit_line = ?
       WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
    ).run(
      options.handoverReason ?? null,
      options.columns?.client_name ?? null,
      options.columns?.dni ?? null,
      options.columns?.credit_line ?? null,
      ref.tenantId,
      ref.channelAccountId,
      ref.phoneNumber,
    );
  }

  function conversation() {
    const row = db
      .prepare(
        `SELECT status, handover_reason, context_data, client_name, dni, credit_line
         FROM conversations
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
      )
      .get(ref.tenantId, ref.channelAccountId, ref.phoneNumber) as {
      status: string;
      handover_reason: string | null;
      context_data: string;
      client_name: string | null;
      dni: string | null;
      credit_line: number | null;
    };
    const context = JSON.parse(row.context_data);
    return {
      status: row.status,
      handoverReason: row.handover_reason,
      phase: context.phase as ConversationPhase,
      metadata: context.metadata as Record<string, unknown>,
      columns: {
        client_name: row.client_name,
        dni: row.dni,
        credit_line: row.credit_line,
      },
    };
  }

  async function customerWrites(text: string): Promise<void> {
    await writeIn(tenant, CUSTOMER, text);
  }

  function inboxStatuses(): string[] {
    return (
      db
        .prepare(
          "SELECT status FROM message_inbox WHERE channel_account_id = ? ORDER BY id",
        )
        .all(tenant.channelAccountId) as Array<{ status: string }>
    ).map((row) => row.status);
  }

  function storedInbound(): string[] {
    return MessageStore.getHistory(ref, 100)
      .filter((m) => m.direction === "inbound")
      .map((m) => m.content);
  }

  function auditActions(): string[] {
    return (
      db
        .prepare(
          "SELECT action FROM audit_log WHERE tenant_id = ? ORDER BY rowid",
        )
        .all(tenant.tenantId) as Array<{ action: string }>
    ).map((row) => row.action);
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("takeover");
    // A number that genuinely sends, so a bot reply reaches the fake network.
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
    agent = createMember(tenant, "sales_agent").userId;

    textSends = [];
    beforeNetworkAnswers = async () => {};
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      await beforeNetworkAnswers();
      if (body.type === "text") textSends.push(body.text.body);
      return new Response(
        JSON.stringify({ messages: [{ id: `wamid-out-${textSends.length}` }] }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;

    lockTimeout = TIMEOUTS as { LOCK_DEFAULT: number };
    savedLockTimeout = lockTimeout.LOCK_DEFAULT;
  });

  afterEach(() => {
    lockTimeout.LOCK_DEFAULT = savedLockTimeout;
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    db.prepare("DELETE FROM audit_log WHERE user_id = ?").run(agent);
    dropTenantFixture(tenant);
  });

  describe("while the bot is answering", () => {
    it("keeps the bot silent on the next message and still stores it", async () => {
      insert(OFFERING);

      await takeoverConversation(ref, agent);
      await customerWrites("quiero el segundo");
      await processReadyMessages();

      expect(textSends).toEqual([]);
      expect(storedInbound()).toEqual(["quiero el segundo"]);
      expect(inboxStatuses()).toEqual(["processed"]);

      const after = conversation();
      expect(after.phase.phase).toBe("escalated");
      expect(after.status).toBe("human_takeover");
      expect(after.handoverReason).toBe("Manual takeover by agent");
    });

    it("keeps the bot silent on a message the held-message sweep answers", async () => {
      insert(OFFERING);
      holdMessage(ref, "quiero el segundo", `wamid-${crypto.randomUUID()}`, 1);

      await takeoverConversation(ref, agent);
      const run = await processHeldMessages(tenant.tenantId);

      expect(run.messagesProcessed).toBe(1);
      expect(textSends).toEqual([]);
      expect(conversation().phase.phase).toBe("escalated");
    });

    it("waits for a bot turn in flight and leaves the conversation escalated", async () => {
      insert({ phase: "greeting" });

      let holdTurn!: () => void;
      const held = new Promise<void>((resolve) => {
        holdTurn = resolve;
      });
      let turnReachedNetwork!: () => void;
      const reached = new Promise<void>((resolve) => {
        turnReachedNetwork = resolve;
      });
      beforeNetworkAnswers = async () => {
        turnReachedNetwork();
        await held;
      };

      await customerWrites("hola");
      const turn = processReadyMessages();
      await reached;

      let takeoverDone = false;
      const takeover = takeoverConversation(ref, agent).then(() => {
        takeoverDone = true;
      });
      await Bun.sleep(50);

      expect(takeoverDone).toBe(false);
      expect(conversation().status).toBe("active");

      holdTurn();
      await Promise.all([turn, takeover]);

      const after = conversation();
      expect(after.phase.phase).toBe("escalated");
      expect(after.status).toBe("human_takeover");
      expect(after.handoverReason).toBe("Manual takeover by agent");
    });

    it("keeps the customer's name, DNI and credit line", async () => {
      insert(OFFERING, {
        metadata: { name: "Juan", dni: "12345678", credit: 5000 },
        columns: { client_name: "Juan", dni: "12345678", credit_line: 5000 },
      });

      await takeoverConversation(ref, agent);

      const after = conversation();
      expect(after.metadata).toMatchObject({
        name: "Juan",
        dni: "12345678",
        credit: 5000,
      });
      expect(after.columns).toEqual({
        client_name: "Juan",
        dni: "12345678",
        credit_line: 5000,
      });
    });

    it("refreshes the activity time, and so does an agent's reply", async () => {
      const stale = Date.now() - 2 * HOUR;
      insert(OFFERING, { lastActivityAt: stale });

      const beforeTakeover = Date.now();
      await takeoverConversation(ref, agent);
      const takenAt = conversation().metadata.lastActivityAt as number;
      expect(takenAt).toBeGreaterThanOrEqual(beforeTakeover);

      db.prepare(
        `UPDATE conversations
         SET context_data = json_set(context_data, '$.metadata.lastActivityAt', ?)
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
      ).run(stale, ref.tenantId, ref.channelAccountId, ref.phoneNumber);

      const beforeReply = Date.now();
      const result = await sendManualMessage(ref, "Hola, soy Ana", agent);

      expect(result).toEqual({ success: true });
      expect(textSends).toEqual(["Hola, soy Ana"]);
      const after = conversation();
      expect(after.metadata.lastActivityAt as number).toBeGreaterThanOrEqual(
        beforeReply,
      );
      expect(after.phase.phase).toBe("escalated");
    });

    it("does not refresh the activity time when nothing was sent", async () => {
      const stale = Date.now() - 2 * HOUR;
      insert(OFFERING, { lastActivityAt: stale });

      const result = await sendManualMessage(ref, "", agent);

      expect(result.success).toBe(false);
      expect(conversation().metadata.lastActivityAt).toBe(stale);
    });
  });

  describe("when an agent replies", () => {
    function rawRow() {
      return db
        .prepare(
          `SELECT * FROM conversations
           WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
        )
        .get(ref.tenantId, ref.channelAccountId, ref.phoneNumber);
    }

    function setContextData(value: string | null): void {
      db.prepare(
        `UPDATE conversations SET context_data = ?
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
      ).run(value, ref.tenantId, ref.channelAccountId, ref.phoneNumber);
    }

    it("leaves the phase and status alone while a bot turn is in flight", async () => {
      // An escalated phase with an active status. Writing this phase back
      // would set the status to human_takeover.
      insert(
        { phase: "escalated", reason: "multiple_objections" },
        { status: "active", lastActivityAt: Date.now() - 2 * HOUR },
      );

      let holdTurn!: () => void;
      const held = new Promise<void>((resolve) => {
        holdTurn = resolve;
      });
      let turnReachedNetwork!: () => void;
      const reached = new Promise<void>((resolve) => {
        turnReachedNetwork = resolve;
      });
      let turnHeld = false;
      beforeNetworkAnswers = async () => {
        if (turnHeld) return;
        turnHeld = true;
        turnReachedNetwork();
        await held;
      };

      await customerWrites("hola");
      const turn = processReadyMessages();
      await reached;
      const before = conversation();

      const beforeReply = Date.now();
      const result = await sendManualMessage(ref, "Hola, soy Ana", agent);
      const during = conversation();
      holdTurn();
      await turn;

      expect(result).toEqual({ success: true });
      expect(textSends).toEqual(["Hola, soy Ana"]);
      expect(during.phase).toEqual(before.phase);
      expect(during.status).toBe("active");
      expect(during.handoverReason).toBeNull();
      expect(during.metadata.lastActivityAt as number).toBeGreaterThanOrEqual(
        beforeReply,
      );
      expect(conversation().status).toBe("active");
    });

    it("refreshes only the activity time", async () => {
      insert(OFFERING, {
        lastActivityAt: Date.now() - 2 * HOUR,
        metadata: { name: "Juan", dni: "12345678" },
        columns: { client_name: "Juan", dni: "12345678", credit_line: 5000 },
      });
      const before = conversation();

      await sendManualMessage(ref, "Hola, soy Ana", agent);

      const after = conversation();
      expect(after.metadata.lastActivityAt as number).toBeGreaterThan(
        before.metadata.lastActivityAt as number,
      );
      expect({
        ...after,
        metadata: { ...after.metadata, lastActivityAt: 0 },
      }).toEqual({
        ...before,
        metadata: { ...before.metadata, lastActivityAt: 0 },
      });
    });

    it("leaves a conversation with no context data as it was", async () => {
      insert(OFFERING);
      setContextData(null);
      const before = rawRow();

      const result = await sendManualMessage(ref, "Hola, soy Ana", agent);

      expect(result).toEqual({ success: true });
      expect(textSends).toEqual(["Hola, soy Ana"]);
      expect(rawRow()).toEqual(before);
    });

    it("does not write a phase into context data that has none", async () => {
      insert(OFFERING);
      setContextData("{}");

      await sendManualMessage(ref, "Hola, soy Ana", agent);

      const stored = JSON.parse(
        (rawRow() as { context_data: string }).context_data,
      );
      expect(stored.phase).toBeUndefined();
    });
  });

  describe("when the person hands the conversation back", () => {
    async function expectBotAnswersAgain(): Promise<void> {
      const released = conversation();
      expect(released.status).toBe("active");
      expect(released.handoverReason).toBeNull();
      expect(released.phase).toEqual({ phase: "greeting" });

      await customerWrites("hola");
      await processReadyMessages();

      expect(textSends.length).toBeGreaterThan(0);
      expect(inboxStatuses()).toEqual(["processed"]);
      expect(conversation().phase.phase).not.toBe("escalated");
    }

    it("after a takeover, the bot answers the next message", async () => {
      insert(OFFERING);

      await takeoverConversation(ref, agent);
      await releaseConversation(ref, agent);

      await expectBotAnswersAgain();
    });

    it("after the bot escalated, the bot answers the next message", async () => {
      insert(
        { phase: "escalated", reason: "multiple_objections" },
        { status: "human_takeover", handoverReason: "multiple_objections" },
      );

      await releaseConversation(ref, agent);

      await expectBotAnswersAgain();
    });

    it("starts over with the customer as a returning user", async () => {
      insert(OFFERING, {
        metadata: { lastCategory: "cocinas", name: "Juan", dni: "12345678" },
      });

      await takeoverConversation(ref, agent);
      await releaseConversation(ref, agent);

      expect(conversation().metadata).toMatchObject({
        isReturningUser: true,
        lastCategory: "cocinas",
      });
      expect(conversation().metadata.dni).toBeUndefined();
    });
  });

  describe("when the person releases a conversation the bot already owns", () => {
    function rawRow() {
      return db
        .prepare(
          `SELECT * FROM conversations
           WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
        )
        .get(ref.tenantId, ref.channelAccountId, ref.phoneNumber);
    }

    function botOwned(): void {
      insert(OFFERING, {
        lastActivityAt: Date.now() - HOUR,
        metadata: { name: "Juan", dni: "12345678", lastCategory: "cocinas" },
        columns: { client_name: "Juan", dni: "12345678", credit_line: 5000 },
      });
    }

    it("changes nothing and answers success", async () => {
      botOwned();
      const before = { row: rawRow(), state: conversation() };

      const result = await releaseConversation(ref, agent);

      expect(result).toEqual({ success: true });
      expect(rawRow()).toEqual(before.row);
      expect(conversation()).toEqual(before.state);
      expect(auditActions()).toEqual([]);
    });

    it("answers success over HTTP and changes nothing", async () => {
      botOwned();
      const before = rawRow();
      const app = new Hono();
      app.onError(errorHandler);
      app.use("/api/*", requireAuth);
      app.route("/api/conversations", conversationRoutes);
      const token = generateSessionToken();
      createSession(token, agent, tenant.tenantId);

      const response = await app.request(
        `/api/conversations/${CUSTOMER}/release`,
        { method: "POST", headers: { Cookie: `session=${token}` } },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      expect(rawRow()).toEqual(before);
      expect(auditActions()).toEqual([]);
    });

    it("does not restart a conversation a second release reaches", async () => {
      insert(OFFERING);
      await takeoverConversation(ref, agent);

      await Promise.all([
        releaseConversation(ref, agent),
        releaseConversation(ref, agent),
      ]);

      expect(auditActions()).toEqual(["takeover", "release"]);
    });

    it("leaves what the first release started alone when a second arrives later", async () => {
      insert(OFFERING);
      await takeoverConversation(ref, agent);
      await releaseConversation(ref, agent);

      await customerWrites("hola");
      await processReadyMessages();
      const answered = conversation();
      expect(answered.phase.phase).toBe("confirming_client");

      await releaseConversation(ref, agent);

      expect(conversation()).toEqual(answered);
      expect(auditActions()).toEqual(["takeover", "release"]);
    });

    it("still moves a conversation that only has the human_takeover status", async () => {
      insert(OFFERING, { status: "human_takeover" });

      await releaseConversation(ref, agent);

      const after = conversation();
      expect(after.status).toBe("active");
      expect(after.phase).toEqual({ phase: "greeting" });
      expect(auditActions()).toEqual(["release"]);
    });

    it("still moves a conversation that only has the escalated phase", async () => {
      insert({ phase: "escalated", reason: "multiple_objections" });

      await releaseConversation(ref, agent);

      const after = conversation();
      expect(after.status).toBe("active");
      expect(after.phase).toEqual({ phase: "greeting" });
      expect(auditActions()).toEqual(["release"]);
    });
  });

  describe("when the conversation lock does not come free", () => {
    async function holdLock(): Promise<() => void> {
      const release = await acquireLock(ref);
      lockTimeout.LOCK_DEFAULT = 30;
      return release;
    }

    it("refuses a takeover and changes nothing", async () => {
      insert(OFFERING);
      const before = conversation();
      const release = await holdLock();

      await expect(takeoverConversation(ref, agent)).rejects.toThrow(
        ConversationBusyError,
      );
      release();

      expect(conversation()).toEqual(before);
      expect(auditActions()).toEqual([]);
    });

    it("refuses a release and changes nothing", async () => {
      insert(
        { phase: "escalated", reason: "Manual takeover by agent" },
        {
          status: "human_takeover",
          handoverReason: "Manual takeover by agent",
        },
      );
      const before = conversation();
      const release = await holdLock();

      await expect(releaseConversation(ref, agent)).rejects.toThrow(
        ConversationBusyError,
      );
      release();

      expect(conversation()).toEqual(before);
      expect(auditActions()).toEqual([]);
    });

    describe("through the HTTP routes", () => {
      let app: Hono;
      let cookie: string;

      beforeEach(() => {
        app = new Hono();
        app.onError(errorHandler);
        app.use("/api/*", requireAuth);
        app.route("/api/conversations", conversationRoutes);

        const token = generateSessionToken();
        createSession(token, agent, tenant.tenantId);
        cookie = `session=${token}`;
      });

      function post(action: "takeover" | "release") {
        return app.request(`/api/conversations/${CUSTOMER}/${action}`, {
          method: "POST",
          headers: { Cookie: cookie },
        });
      }

      for (const action of ["takeover", "release"] as const) {
        it(`answers ${action} with an error the dashboard can show`, async () => {
          insert(OFFERING);
          const before = conversation();
          const release = await holdLock();

          const response = await post(action);
          release();

          expect(response.status).toBe(409);
          expect(await response.json()).toEqual({
            error: "The conversation is busy. Try again in a moment.",
          });
          expect(conversation()).toEqual(before);
          expect(auditActions()).toEqual([]);
        });
      }

      it("writes one audit row for each of takeover and release", async () => {
        insert(OFFERING);

        expect((await post("takeover")).status).toBe(200);
        expect((await post("release")).status).toBe(200);

        expect(auditActions()).toEqual(["takeover", "release"]);
      });
    });
  });

  describe("the idle reset", () => {
    it("still hands an escalated conversation back to the bot", async () => {
      insert(
        { phase: "escalated", reason: "multiple_objections" },
        {
          status: "human_takeover",
          handoverReason: "multiple_objections",
          lastActivityAt: Date.now() - 4 * HOUR,
        },
      );

      await customerWrites("hola");
      await processReadyMessages();

      expect(textSends.length).toBeGreaterThan(0);
      const after = conversation();
      expect(after.status).toBe("active");
      expect(after.handoverReason).toBeNull();
      expect(after.phase.phase).not.toBe("escalated");
    });

    it("restarts an idle conversation the bot was answering", async () => {
      insert(OFFERING, { lastActivityAt: Date.now() - 4 * HOUR });

      await customerWrites("hola");
      await processReadyMessages();

      expect(textSends.length).toBeGreaterThan(0);
      expect(conversation().phase.phase).toBe("confirming_client");
    });

    it("leaves a conversation an agent answered recently with the agent", async () => {
      insert(OFFERING, { lastActivityAt: Date.now() - 4 * HOUR });
      await takeoverConversation(ref, agent);
      await sendManualMessage(ref, "Hola, soy Ana", agent);
      textSends.length = 0;

      await customerWrites("gracias");
      await processReadyMessages();

      expect(textSends).toEqual([]);
      expect(conversation().phase.phase).toBe("escalated");
    });
  });
});

/**
 * A whole turn whose first reply WhatsApp would not take. The rest of the turn
 * queues behind it, the conversation still moves on, and the worker delivers
 * every reply in the order the bot produced them. Each test runs the real path
 * from a signed webhook, and the only fake is the network.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import process from "node:process";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";
import { customerWrites } from "./helpers/turn.ts";

import type { ConversationMetadata, ConversationPhase } from "@vendeya/core";
import type { ConversationRef } from "@vendeya/types";

import { processReadyMessages } from "../src/conversation/aggregator-worker.ts";
import { executeCommands } from "../src/conversation/handler/command-executor.ts";
import type { OutboxRow } from "../src/conversation/outbox.ts";
import {
  processDueOutbox,
  stopOutboxWorker,
} from "../src/conversation/outbox-worker.ts";
import { BundleService } from "../src/domains/catalog/bundles.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";

const CUSTOMER = "51900666001";
const HOUR = 60 * 60 * 1000;

const OFFERING: ConversationPhase = {
  phase: "offering_products",
  segment: "fnb",
  credit: 5000,
  name: "Juan",
};

describe("a turn whose first reply could not be sent", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let originalFetch: typeof globalThis.fetch;
  /** What WhatsApp accepted, in order: a text body or an image link. */
  let delivered: string[];
  /** Sends refused so far, and how many to refuse before accepting. */
  let refused: number;
  let toRefuse: number;
  let bundleIds: string[];

  function rows(): OutboxRow[] {
    return db
      .prepare(
        `SELECT * FROM outbox
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
         ORDER BY id`,
      )
      .all(ref.tenantId, ref.channelAccountId, ref.phoneNumber) as OutboxRow[];
  }

  function outboundStatuses(): string[] {
    return (
      db
        .prepare(
          `SELECT status FROM messages
           WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
             AND direction = 'outbound'
           ORDER BY created_at, ROWID`,
        )
        .all(ref.tenantId, ref.channelAccountId, ref.phoneNumber) as Array<{
        status: string;
      }>
    ).map((row) => row.status);
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

  function phase(): ConversationPhase {
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

  function goIdle(): void {
    db.prepare(
      `UPDATE conversations
       SET context_data = json_set(context_data, '$.metadata.lastActivityAt', ?)
       WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
    ).run(
      Date.now() - 4 * HOUR,
      ref.tenantId,
      ref.channelAccountId,
      ref.phoneNumber,
    );
  }

  /** Runs passes until the conversation owes nothing, at a clock the test moves. */
  async function drainOutbox(): Promise<void> {
    for (let pass = 0; pass < 10; pass++) {
      const waiting = rows().filter(
        (row) => row.status === "pending" || row.status === "sending",
      );
      if (waiting.length === 0) return;
      await processDueOutbox(waiting[0]!.next_attempt_at);
    }
    throw new Error("The outbox did not drain");
  }

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("outbox-turn");
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

    const periodId = `per-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO catalog_periods (id, tenant_id, name, year_month, status)
       VALUES (?, ?, 'Enero', '2026-01', 'active')`,
    ).run(periodId, tenant.tenantId);
    bundleIds = [
      ["Cocina 2 hornillas", 800, "img-cheap"],
      ["Cocina 4 hornillas", 1200, "img-dear"],
    ].map(([name, price, imageId]) => {
      const id = `bundle-${crypto.randomUUID()}`;
      BundleService.create({
        id,
        tenantId: tenant.tenantId,
        period_id: periodId,
        segment: "fnb",
        name: name as string,
        price: price as number,
        primary_category: "cocinas",
        categories_json: JSON.stringify(["cocinas"]),
        image_id: imageId as string,
        composition_json: JSON.stringify({ fixed: [], choices: [] }),
        installments_json: JSON.stringify([{ months: 12, monthlyAmount: 110 }]),
        created_by: null,
      });
      return id;
    });

    delivered = [];
    refused = 0;
    toRefuse = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.type !== "text" && body.type !== "image") {
        // A read receipt, which is not part of the reply.
        return new Response(JSON.stringify({ messages: [{ id: "wamid-r" }] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (refused < toRefuse) {
        refused++;
        return new Response("<html>Bad gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        });
      }
      delivered.push(
        body.type === "text"
          ? body.text.body
          : String(body.image.link).replace(/^.*\/media\/images\//, "images/"),
      );
      return new Response(
        JSON.stringify({ messages: [{ id: `wamid-out-${delivered.length}` }] }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(async () => {
    await stopOutboxWorker();
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  it("queues the whole turn behind the reply that failed, and delivers it in order", async () => {
    insertConversation(ref, {
      contextData: {
        phase: OFFERING,
        metadata: {
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
          segment: "fnb",
          credit: 5000,
          dni: "12345678",
          name: "Juan",
        },
      },
    });
    toRefuse = 1;

    await customerWrites(tenant, CUSTOMER, "quiero ver cocinas");
    await processReadyMessages();

    // Two bundle images and the follow-up text. Only the first reached
    // WhatsApp, and the rest queued behind it without a request.
    const queued = rows();
    expect(queued.map((row) => row.type)).toEqual(["image", "image", "text"]);
    expect(queued.map((row) => row.status)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
    expect(refused).toBe(1);
    expect(delivered).toEqual([]);
    expect(queued[0]).toMatchObject({ attempts: 1, last_kind: "transient" });
    expect(queued[1]).toMatchObject({ attempts: 0, last_kind: null });
    expect(queued[2]).toMatchObject({ attempts: 0, last_kind: null });
    expect(outboundStatuses()).toEqual(["queued", "queued", "queued"]);

    // The turn finished: the customer's message is answered for, and the phase
    // records both products, because a queued image still reaches the customer.
    expect(inboxStatuses()).toEqual(["processed"]);
    expect(phase()).toMatchObject({
      phase: "offering_products",
      sentProducts: [{ productId: bundleIds[0] }, { productId: bundleIds[1] }],
    });

    const order = queued.map((row) => row.content);

    await drainOutbox();

    expect(delivered).toEqual(order);
    expect(rows().map((row) => row.status)).toEqual(["sent", "sent", "sent"]);
    expect(outboundStatuses()).toEqual(["sent", "sent", "sent"]);
  });

  it("keeps the next turn's reply behind the one still owed", async () => {
    insertConversation(ref);
    toRefuse = 1;

    await customerWrites(tenant, CUSTOMER, "hola");
    await processReadyMessages();

    expect(rows()).toHaveLength(1);
    expect(refused).toBe(1);
    expect(phase().phase).toBe("confirming_client");

    // The customer comes back after the idle reset, so the bot greets again.
    goIdle();
    await customerWrites(tenant, CUSTOMER, "hola de nuevo");
    await processReadyMessages();

    const queued = rows();
    expect(queued).toHaveLength(2);
    expect(queued[1]).toMatchObject({ status: "pending", attempts: 0 });
    expect(delivered).toEqual([]);
    expect(inboxStatuses()).toEqual(["processed", "processed"]);

    const order = queued.map((row) => row.content);

    await drainOutbox();

    expect(delivered).toEqual(order);
    expect(rows().map((row) => row.status)).toEqual(["sent", "sent"]);
  });

  it("records a single bundle as shown once its image is queued", async () => {
    insertConversation(ref, {
      contextData: {
        phase: OFFERING,
        metadata: { createdAt: Date.now(), lastActivityAt: Date.now() },
      },
    });
    toRefuse = 1;

    await executeCommands(
      {
        type: "update",
        nextPhase: OFFERING,
        commands: [{ type: "SEND_BUNDLE", bundleId: bundleIds[1]! }],
      },
      ref,
      {
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      } as ConversationMetadata,
      false,
      "trace",
    );

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ type: "image", status: "pending" });
    expect(phase()).toMatchObject({
      sentProducts: [{ productId: bundleIds[1], position: 1 }],
      lastAction: { type: "showed_products", productCount: 1 },
    });

    await drainOutbox();

    expect(delivered).toEqual(["images/img-dear.jpg"]);
  });
});

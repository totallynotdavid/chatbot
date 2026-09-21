/**
 * A send that WhatsApp did not accept must not be reported as one that went
 * out. The bundle images, the phase the executor persists and an agent's manual
 * reply each act on the outcome. The only fake is the network.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
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
import type { ConversationRef } from "@vendeya/types";

import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import { executeCommands } from "../src/conversation/handler/command-executor.ts";
import { sendBundleImages } from "../src/conversation/images.ts";
import { BundleService } from "../src/domains/catalog/bundles.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { sendManualMessage } from "../src/domains/conversations/write.ts";

const CUSTOMER = "51900888001";
const IMAGE_CHEAP = "img-cheap";
const IMAGE_DEAR = "img-dear";

const OFFERING: ConversationPhase = {
  phase: "offering_products",
  segment: "fnb",
  credit: 5000,
  name: "Juan",
};

describe("a send WhatsApp did not accept", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let ref: ConversationRef;
  let agent: string;
  let cheapId: string;
  let dearId: string;
  let originalFetch: typeof globalThis.fetch;
  /** Request bodies that reached the network, in order. */
  let requests: Array<Record<string, any>>;
  /** Decides the answer to one request. */
  let answer: (body: Record<string, any>) => Response;

  const accepted = () =>
    new Response(
      JSON.stringify({ messages: [{ id: `wamid-${crypto.randomUUID()}` }] }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  const refused = () =>
    new Response(JSON.stringify({ error: { code: 131047 } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  const refusesImage = (imageId: string) => (body: Record<string, any>) =>
    body.type === "image" && body.image.link.includes(imageId)
      ? refused()
      : accepted();
  const refusesEverything = () => refused();

  function imageRequests() {
    return requests.filter((r) => r.type === "image");
  }
  function textRequests() {
    return requests.filter((r) => r.type === "text");
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

  function auditActions(): string[] {
    return (
      db
        .prepare("SELECT action FROM audit_log WHERE tenant_id = ?")
        .all(tenant.tenantId) as Array<{ action: string }>
    ).map((row) => row.action);
  }

  function createBundle(name: string, price: number, imageId: string): string {
    const id = `bundle-${crypto.randomUUID()}`;
    BundleService.create({
      id,
      tenantId: tenant.tenantId,
      period_id: periodId,
      segment: "fnb",
      name,
      price,
      primary_category: "cocinas",
      categories_json: JSON.stringify(["cocinas"]),
      image_id: imageId,
      composition_json: JSON.stringify({ fixed: [], choices: [] }),
      installments_json: JSON.stringify([{ months: 12, monthlyAmount: 110 }]),
      created_by: null,
    });
    return id;
  }

  let periodId: string;

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "e5".repeat(32);

    applySchema();
    tenant = createTenantFixture("send-failure");
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
    insertConversation(ref);
    agent = createMember(tenant, "sales_agent").userId;

    periodId = `per-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO catalog_periods (id, tenant_id, name, year_month, status)
       VALUES (?, ?, 'Enero', '2026-01', 'active')`,
    ).run(periodId, tenant.tenantId);
    cheapId = createBundle("Cocina 2 hornillas", 800, IMAGE_CHEAP);
    dearId = createBundle("Cocina 4 hornillas", 1200, IMAGE_DEAR);

    requests = [];
    answer = () => accepted();
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      requests.push(body);
      return answer(body);
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  describe("when the bundle images are sent", () => {
    const params = () => ({
      ref,
      segment: "fnb" as const,
      creditLine: 5000,
      isSimulation: false,
    });

    it("reports success and both products when every image is accepted", async () => {
      const result = await sendBundleImages(params());

      expect(result.success).toBe(true);
      expect(result.products.map((p) => p.productId)).toEqual([
        cheapId,
        dearId,
      ]);
      expect(textRequests()).toHaveLength(1);
    });

    it("reports no success, no products and no follow-up when every image is refused", async () => {
      answer = refusesEverything;

      const result = await sendBundleImages(params());

      expect(result).toEqual({ success: false, products: [] });
      expect(imageRequests()).toHaveLength(2);
      expect(textRequests()).toHaveLength(0);
    });

    it("returns only the accepted product, at its original position, when one is refused", async () => {
      answer = refusesImage(IMAGE_CHEAP);

      const result = await sendBundleImages(params());

      expect(result.success).toBe(true);
      expect(result.products).toEqual([
        {
          name: "Cocina 4 hornillas",
          position: 2,
          productId: dearId,
          price: 1200,
        },
      ]);
      expect(textRequests()).toHaveLength(1);
    });

    it("still reports every product for a simulated conversation", async () => {
      const result = await sendBundleImages({
        ...params(),
        isSimulation: true,
      });

      expect(result.success).toBe(true);
      expect(result.products).toHaveLength(2);
      expect(requests).toHaveLength(0);
    });
  });

  describe("when the executor records what the customer was shown", () => {
    const metadata = {
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    } as ConversationMetadata;

    const images = {
      type: "update" as const,
      nextPhase: OFFERING,
      commands: [{ type: "SEND_IMAGES" as const, category: "cocinas" }],
    };
    const bundle = () => ({
      type: "update" as const,
      nextPhase: OFFERING,
      commands: [{ type: "SEND_BUNDLE" as const, bundleId: dearId }],
    });

    it("records sentProducts for an accepted category image", async () => {
      await executeCommands(images, ref, metadata, false, "trace");

      expect(storedPhase()).toMatchObject({
        phase: "offering_products",
        sentProducts: [{ productId: cheapId }, { productId: dearId }],
      });
    });

    it("records no sentProducts when every category image is refused", async () => {
      answer = refusesEverything;

      await executeCommands(images, ref, metadata, false, "trace");

      const phase = storedPhase();
      expect(phase.phase).toBe("offering_products");
      expect(phase).not.toHaveProperty("sentProducts");
      expect(phase).not.toHaveProperty("lastAction");
    });

    it("records only the accepted products when one category image is refused", async () => {
      answer = refusesImage(IMAGE_CHEAP);

      await executeCommands(images, ref, metadata, false, "trace");

      expect(storedPhase()).toMatchObject({
        sentProducts: [{ productId: dearId, position: 2 }],
        lastAction: { type: "showed_products", productCount: 1 },
      });
    });

    it("records sentProducts for an accepted single bundle", async () => {
      await executeCommands(bundle(), ref, metadata, false, "trace");

      expect(storedPhase()).toMatchObject({
        sentProducts: [{ productId: dearId, position: 1 }],
      });
    });

    it("records no sentProducts when the single bundle image is refused", async () => {
      answer = refusesEverything;

      await executeCommands(bundle(), ref, metadata, false, "trace");

      const phase = storedPhase();
      expect(phase.phase).toBe("offering_products");
      expect(phase).not.toHaveProperty("sentProducts");
      expect(phase).not.toHaveProperty("lastAction");
    });

    it("persists the phase after a text send that failed, and does not throw", async () => {
      answer = refusesEverything;

      await executeCommands(
        {
          type: "update",
          nextPhase: OFFERING,
          commands: [{ type: "SEND_MESSAGE", text: "hola" }],
        },
        ref,
        metadata,
        false,
        "trace",
      );

      expect(storedPhase().phase).toBe("offering_products");
      expect(MessageStore.getHistory(ref)[0]).toMatchObject({
        status: "failed",
      });
    });
  });

  describe("when an agent sends a manual reply", () => {
    it("answers success and writes the audit row when the reply went out", async () => {
      const result = await sendManualMessage(ref, "Hola, soy Ana", agent);

      expect(result).toEqual({ success: true });
      expect(textRequests()).toHaveLength(1);
      expect(auditActions()).toEqual(["send_message"]);
    });

    it("answers a failure the dashboard can show, and writes no audit row, when the reply was refused", async () => {
      answer = refusesEverything;

      const result = await sendManualMessage(ref, "Hola, soy Ana", agent);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain("Hola, soy Ana");
      expect(auditActions()).toEqual([]);
      expect(MessageStore.getHistory(ref)[0]).toMatchObject({
        status: "failed",
      });
    });

    it("answers a failure when WhatsApp cannot be reached", async () => {
      globalThis.fetch = (async () => {
        throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      }) as unknown as typeof globalThis.fetch;

      const result = await sendManualMessage(ref, "Hola, soy Ana", agent);

      expect(result.success).toBe(false);
      expect(auditActions()).toEqual([]);
    });
  });
});

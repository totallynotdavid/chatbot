import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { db } from "../src/db/index.ts";
import type { ConversationRef } from "@totem/types";

import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import webhook from "../src/routes/webhook.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import { BundleService } from "../src/domains/catalog/bundles.ts";
import { PeriodService } from "../src/domains/catalog/periods.ts";
import { ProductService } from "../src/domains/catalog/products.ts";
import { AssetService } from "../src/domains/assets/index.ts";
import { canAccessTenant } from "../src/platform/auth/scope.ts";
import {
  getOrders,
  getOrderById,
  getOrderByConversation,
} from "../src/domains/orders/read.ts";
import { createOrder } from "../src/domains/orders/write.ts";
import {
  listConversations,
  lookupConversation,
} from "../src/domains/conversations/read.ts";
import {
  findConversation,
  getOrCreateConversation,
} from "../src/conversation/store.ts";
import { trackEvent, getRecentEvents } from "../src/domains/analytics/index.ts";
import {
  getRecentLLMCalls,
  trackLLMCall,
} from "../src/intelligence/tracker.ts";
import { assignNextAgent } from "../src/domains/conversations/assignment.ts";
import { MembershipService } from "../src/domains/tenants/index.ts";
import { PersonasService } from "../src/domains/personas/index.ts";
import { seedPeriods } from "../src/db/seeds/periods.ts";
import { seedProducts } from "../src/db/seeds/products.ts";
import { seedBundles } from "../src/db/seeds/bundles.ts";

/**
 * The same customer phone number, messaging two different businesses. Every
 * assertion below is about that collision: the two tenants must never see each
 * other's copy of it.
 */
const SHARED_PHONE = "51987654321";

describe("tenant isolation", () => {
  let alpha: TenantFixture;
  let beta: TenantFixture;
  let alphaRef: ConversationRef;
  let betaRef: ConversationRef;

  beforeEach(() => {
    applySchema();
    alpha = createTenantFixture("alpha");
    beta = createTenantFixture("beta");
    alphaRef = alpha.ref(SHARED_PHONE);
    betaRef = beta.ref(SHARED_PHONE);
  });

  afterEach(() => {
    dropTenantFixture(alpha);
    dropTenantFixture(beta);
  });

  describe("the same phone number in two tenants", () => {
    it("creates two independent conversations", () => {
      const a = getOrCreateConversation(alphaRef);
      const b = getOrCreateConversation(betaRef);

      expect(a.ref.tenantId).toBe(alpha.tenantId);
      expect(b.ref.tenantId).toBe(beta.tenantId);

      const rows = db
        .prepare(
          "SELECT tenant_id FROM conversations WHERE phone_number = ? AND tenant_id IN (?, ?)",
        )
        .all(SHARED_PHONE, alpha.tenantId, beta.tenantId) as Array<{
        tenant_id: string;
      }>;

      expect(rows).toHaveLength(2);
    });

    it("keeps conversation state separate", () => {
      insertConversation(alphaRef, { clientName: "Alpha Client" });
      insertConversation(betaRef, { clientName: "Beta Client" });

      expect(findConversation(alphaRef)?.client_name).toBe("Alpha Client");
      expect(findConversation(betaRef)?.client_name).toBe("Beta Client");
    });

    it("keeps message history separate", () => {
      insertConversation(alphaRef);
      insertConversation(betaRef);

      MessageStore.log(alphaRef, "inbound", "text", "hola alpha");
      MessageStore.log(betaRef, "inbound", "text", "hola beta");

      const alphaMessages = MessageStore.getHistory(alphaRef);
      const betaMessages = MessageStore.getHistory(betaRef);

      expect(alphaMessages).toHaveLength(1);
      expect(alphaMessages[0]!.content).toBe("hola alpha");
      expect(betaMessages).toHaveLength(1);
      expect(betaMessages[0]!.content).toBe("hola beta");
    });

    it("keeps analytics events separate", () => {
      insertConversation(alphaRef);
      insertConversation(betaRef);

      trackEvent(alphaRef, "session_start");
      trackEvent(betaRef, "session_start");

      const alphaEvents = getRecentEvents(alpha.tenantId, 50);
      const betaEvents = getRecentEvents(beta.tenantId, 50);

      expect(alphaEvents).toHaveLength(1);
      expect(betaEvents).toHaveLength(1);
      expect(alphaEvents[0]!.tenant_id).toBe(alpha.tenantId);
      expect(betaEvents[0]!.tenant_id).toBe(beta.tenantId);
    });
  });

  describe("reads outside the caller's tenant", () => {
    it("does not list another tenant's conversations", () => {
      insertConversation(alphaRef, { clientName: "Alpha Client" });
      insertConversation(betaRef, { clientName: "Beta Client" });

      const alphaAdmin = createMember(alpha, "admin");
      const rows = listConversations(alphaAdmin.scope, null, "admin");

      expect(rows.every((r) => r.tenant_id === alpha.tenantId)).toBe(true);
      expect(rows.map((r) => r.client_name)).not.toContain("Beta Client");
    });

    it("does not resolve another tenant's conversation by phone number", () => {
      insertConversation(betaRef, { clientName: "Beta Client" });

      const alphaAdmin = createMember(alpha, "admin");
      const resolved = lookupConversation(alphaAdmin.scope, SHARED_PHONE, null);

      expect(resolved.status).toBe("not_found");
    });

    it("scopes a sales agent to their own assignments inside their tenant", () => {
      const alphaAgent = createMember(alpha, "sales_agent");
      const betaAgent = createMember(beta, "sales_agent");

      insertConversation(alphaRef, {
        clientName: "Alpha Client",
        assignedAgent: alphaAgent.userId,
      });
      insertConversation(betaRef, {
        clientName: "Beta Client",
        assignedAgent: betaAgent.userId,
      });

      const rows = listConversations(alphaAgent.scope, null, "sales_agent");

      expect(rows).toHaveLength(1);
      expect(rows[0]!.tenant_id).toBe(alpha.tenantId);
    });

    it("does not return another tenant's orders", () => {
      insertConversation(alphaRef);
      insertConversation(betaRef);

      const alphaOrder = createOrder({
        ref: alphaRef,
        clientName: "Alpha Client",
        clientDni: "12345678",
        products: [
          { productId: "p1", name: "Cocina", price: 100, quantity: 1 },
        ],
        totalAmount: 100,
        deliveryAddress: "Lima",
      });

      const betaOrder = createOrder({
        ref: betaRef,
        clientName: "Beta Client",
        clientDni: "87654321",
        products: [{ productId: "p2", name: "Terma", price: 200, quantity: 1 }],
        totalAmount: 200,
        deliveryAddress: "Callao",
      });

      expect(getOrders(alpha.tenantId).map((o) => o.id)).toEqual([
        alphaOrder.id,
      ]);
      expect(getOrderById(alpha.tenantId, betaOrder.id)).toBeNull();
      expect(getOrderByConversation(alphaRef)?.id).toBe(alphaOrder.id);
      expect(getOrderByConversation(betaRef)?.id).toBe(betaOrder.id);
    });

    it("does not return another tenant's catalog", () => {
      const alphaPeriod = PeriodService.create({
        tenantId: alpha.tenantId,
        name: "Septiembre",
        year_month: "2026-09",
        created_by: null,
      });
      // The same period name in another tenant must not collide.
      const betaPeriod = PeriodService.create({
        tenantId: beta.tenantId,
        name: "Septiembre",
        year_month: "2026-09",
        created_by: null,
      });

      expect(alphaPeriod.id).not.toBe(betaPeriod.id);
      expect(PeriodService.getById(alpha.tenantId, betaPeriod.id)).toBeNull();
      expect(PeriodService.getAll(alpha.tenantId)).toHaveLength(1);

      PeriodService.updateStatus(alpha.tenantId, alphaPeriod.id, "active");
      PeriodService.updateStatus(beta.tenantId, betaPeriod.id, "active");

      // Publishing one tenant's period must not archive another's.
      expect(PeriodService.getActive(alpha.tenantId)?.id).toBe(alphaPeriod.id);
      expect(PeriodService.getActive(beta.tenantId)?.id).toBe(betaPeriod.id);

      const betaBundle = BundleService.create({
        id: `bundle-${crypto.randomUUID()}`,
        tenantId: beta.tenantId,
        period_id: betaPeriod.id,
        segment: "gaso",
        name: "Beta Combo",
        price: 500,
        primary_category: "cocinas",
        categories_json: "[]",
        image_id: "beta-image",
        composition_json: '{"fixed":[],"choices":[]}',
        installments_json: "[]",
        created_by: null,
      });

      expect(BundleService.getById(alpha.tenantId, betaBundle.id)).toBeNull();
      expect(BundleService.getAvailable(alpha.tenantId)).toHaveLength(0);
      expect(BundleService.getAvailable(beta.tenantId)).toHaveLength(1);
      expect(
        BundleService.getByPeriod(alpha.tenantId, betaPeriod.id),
      ).toHaveLength(0);

      ProductService.create({
        id: `prod-${crypto.randomUUID()}`,
        tenantId: beta.tenantId,
        name: "Beta Product",
        category: "cocinas",
      });

      expect(ProductService.getAll(alpha.tenantId)).toHaveLength(0);
      expect(ProductService.getAll(beta.tenantId)).toHaveLength(1);
    });

    it("does not return another tenant's media assets", () => {
      const betaAsset = AssetService.create({
        tenantId: beta.tenantId,
        kind: "contract",
        visibility: "private",
        storageKey: `${beta.tenantId}/contracts/x.pdf`,
      });

      const alphaAdmin = createMember(alpha, "admin");

      expect(AssetService.getById(alpha.tenantId, betaAsset.id)).toBeNull();
      expect(AssetService.listForTenant(alpha.tenantId)).toHaveLength(0);

      // This is the check /api/assets/:id makes before serving any bytes.
      expect(canAccessTenant(alphaAdmin.scope, betaAsset.tenant_id)).toBe(
        false,
      );
      expect(canAccessTenant(alphaAdmin.scope, alpha.tenantId)).toBe(true);
    });

    it("does not return another tenant's LLM traces", () => {
      insertConversation(alphaRef);
      insertConversation(betaRef);

      for (const ref of [alphaRef, betaRef]) {
        trackLLMCall({
          ref,
          operation: "isQuestion",
          model: "test-model",
          prompt: "",
          userMessage: "",
          status: "success",
          latencyMs: 1,
        });
      }

      // trackLLMCall writes on a detached promise; drain the microtask queue.
      return Promise.resolve().then(() => {
        const alphaCalls = getRecentLLMCalls(alpha.tenantId, 50) as Array<{
          tenant_id: string;
        }>;
        const betaCalls = getRecentLLMCalls(beta.tenantId, 50) as Array<{
          tenant_id: string;
        }>;

        expect(alphaCalls).toHaveLength(1);
        expect(betaCalls).toHaveLength(1);
        expect(alphaCalls[0]!.tenant_id).toBe(alpha.tenantId);
        expect(betaCalls[0]!.tenant_id).toBe(beta.tenantId);
      });
    });
  });

  describe("platform operators", () => {
    it("read across tenants only while unpinned, and are scoped once pinned", () => {
      insertConversation(alphaRef, { clientName: "Alpha Client" });
      insertConversation(betaRef, { clientName: "Beta Client" });

      const unpinned = {
        userId: "op-1",
        tenantId: null,
        membershipRole: null,
        isPlatformOperator: true,
      };

      const acrossTenants = listConversations(unpinned, null, "admin")
        .filter((r) => [alpha.tenantId, beta.tenantId].includes(r.tenant_id))
        .map((r) => r.tenant_id);

      expect(acrossTenants.sort()).toEqual(
        [alpha.tenantId, beta.tenantId].sort(),
      );

      const pinned = { ...unpinned, tenantId: alpha.tenantId };
      const scoped = listConversations(pinned, null, "admin");

      expect(scoped.every((r) => r.tenant_id === alpha.tenantId)).toBe(true);
    });

    it("refuses a user who is neither a member nor platform staff", () => {
      insertConversation(alphaRef, { clientName: "Alpha Client" });

      const outsider = {
        userId: "u-outsider",
        tenantId: null,
        membershipRole: null,
        isPlatformOperator: false,
      };

      expect(lookupConversation(outsider, SHARED_PHONE, null).status).toBe(
        "not_found",
      );
    });
  });

  /**
   * Regression: availability was a single flag on the user record, and the
   * assignment query read it per tenant. One agent selling for two businesses
   * who went offline for one was silently pulled out of both rotations. It lives
   * on the membership now.
   */
  describe("an agent who sells for both", () => {
    let agentId: string;

    beforeEach(() => {
      const agent = createMember(alpha, "sales_agent");
      agentId = agent.userId;

      db.prepare(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
         VALUES (?, ?, ?, 'sales_agent')`,
      ).run(crypto.randomUUID(), beta.tenantId, agentId);

      insertConversation(alphaRef);
      insertConversation(betaRef);
    });

    it("stays in the other tenant's rotation after going offline in one", async () => {
      MembershipService.setAvailability(alpha.tenantId, agentId, false);

      expect(await assignNextAgent(alphaRef, "Cliente")).toBeNull();
      expect(await assignNextAgent(betaRef, "Cliente")).toBe(agentId);
    });

    it("is assigned in both while available in both", async () => {
      expect(await assignNextAgent(alphaRef, "Cliente")).toBe(agentId);
      expect(await assignNextAgent(betaRef, "Cliente")).toBe(agentId);
    });

    it("is out of both when the account itself is deactivated", async () => {
      db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(agentId);

      expect(await assignNextAgent(alphaRef, "Cliente")).toBeNull();
      expect(await assignNextAgent(betaRef, "Cliente")).toBeNull();
    });
  });

  /**
   * Regression: the catalog seeds used the base catalog's own ids, which are
   * global primary keys, so onboarding a second business died on
   * `UNIQUE constraint failed: products.id`.
   */
  describe("seeding a second business", () => {
    async function seedCatalog(tenantId: string) {
      await seedPeriods(db, tenantId);
      await seedProducts(db, tenantId);
      await seedBundles(db, tenantId);
    }

    it("gives each tenant its own copy of the base catalog", async () => {
      await seedCatalog(alpha.tenantId);
      await seedCatalog(beta.tenantId);

      const alphaProducts = ProductService.getAll(alpha.tenantId);
      const betaProducts = ProductService.getAll(beta.tenantId);

      expect(alphaProducts.length).toBeGreaterThan(0);
      expect(betaProducts).toHaveLength(alphaProducts.length);

      const alphaIds = new Set(alphaProducts.map((p) => p.id));
      expect(betaProducts.some((p) => alphaIds.has(p.id))).toBe(false);

      const alphaBundles = BundleService.getAvailable(alpha.tenantId);
      expect(alphaBundles.length).toBeGreaterThan(0);
      expect(BundleService.getAvailable(beta.tenantId)).toHaveLength(
        alphaBundles.length,
      );
    });

    it("keeps each bundle's composition pointing at its own tenant's products", async () => {
      await seedCatalog(alpha.tenantId);
      await seedCatalog(beta.tenantId);

      // getActiveBrands joins composition_json back to `products` inside the
      // tenant, so brands only come out if the snapshotted ids are that
      // tenant's own.
      const brands = ProductService.getActiveBrands(beta.tenantId);
      expect(brands.length).toBeGreaterThan(0);
      expect(ProductService.getActiveBrands(alpha.tenantId)).toEqual(brands);
    });
  });

  /**
   * Regression: `test_personas.id` was a global primary key while the id itself
   * is typed in by the tenant's own users. The second business to name a
   * persona "cliente_moroso" got a UNIQUE constraint failure and a 500.
   */
  describe("simulator personas", () => {
    const PERSONA_ID = "cliente_moroso";

    function persona(clientName: string) {
      return {
        id: PERSONA_ID,
        name: "Cliente moroso",
        description: "Deuda vigente",
        segment: "gaso" as const,
        clientName,
        dni: "12345678",
        creditLine: 3000,
      };
    }

    it("lets two tenants use the same persona id", () => {
      const alphaAuthor = createMember(alpha).userId;
      const betaAuthor = createMember(beta).userId;

      PersonasService.create(alpha.tenantId, persona("Ana"), alphaAuthor);
      PersonasService.create(beta.tenantId, persona("Beto"), betaAuthor);

      expect(
        PersonasService.getById(alpha.tenantId, PERSONA_ID)?.clientName,
      ).toBe("Ana");
      expect(
        PersonasService.getById(beta.tenantId, PERSONA_ID)?.clientName,
      ).toBe("Beto");
    });

    it("keeps an edit inside the tenant that made it", () => {
      const alphaAuthor = createMember(alpha).userId;
      const betaAuthor = createMember(beta).userId;

      PersonasService.create(alpha.tenantId, persona("Ana"), alphaAuthor);
      PersonasService.create(beta.tenantId, persona("Beto"), betaAuthor);

      PersonasService.update(alpha.tenantId, PERSONA_ID, {
        clientName: "Ana María",
      });

      expect(
        PersonasService.getById(alpha.tenantId, PERSONA_ID)?.clientName,
      ).toBe("Ana María");
      expect(
        PersonasService.getById(beta.tenantId, PERSONA_ID)?.clientName,
      ).toBe("Beto");
    });

    it("keeps a deletion inside the tenant that made it", () => {
      const alphaAuthor = createMember(alpha).userId;
      const betaAuthor = createMember(beta).userId;

      PersonasService.create(alpha.tenantId, persona("Ana"), alphaAuthor);
      PersonasService.create(beta.tenantId, persona("Beto"), betaAuthor);

      PersonasService.delete(alpha.tenantId, PERSONA_ID);

      expect(
        PersonasService.getById(beta.tenantId, PERSONA_ID)?.clientName,
      ).toBe("Beto");
    });
  });

  describe("inbound webhook routing", () => {
    function payload(phoneNumberId: string, from: string, body: string) {
      return {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "waba-1",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "51900000000",
                    phone_number_id: phoneNumberId,
                  },
                  messages: [
                    {
                      from,
                      id: `wamid-${crypto.randomUUID()}`,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: { body },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
    }

    /**
     * One entry per number, each carrying however many messages Meta batched
     * into it. A single POST legitimately spans WABAs, numbers and tenants.
     */
    function batch(
      changes: Array<{ phoneNumberId: string; bodies: string[] }>,
    ) {
      return {
        object: "whatsapp_business_account",
        entry: changes.map(({ phoneNumberId, bodies }, index) => ({
          id: `waba-${index}`,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "51900000000",
                  phone_number_id: phoneNumberId,
                },
                messages: bodies.map((body) => ({
                  from: SHARED_PHONE,
                  id: `wamid-${crypto.randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body },
                })),
              },
            },
          ],
        })),
      };
    }

    async function post(body: unknown) {
      return webhook.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    /** What became of each message in the payload, in the order it was sent. */
    async function statuses(response: Response): Promise<string[]> {
      const body = (await response.json()) as {
        results: Array<{ status: string }>;
      };
      return body.results.map((result) => result.status);
    }

    function queued(): Array<{ tenant_id: string; message_text: string }> {
      return db
        .prepare(
          `SELECT tenant_id, message_text FROM message_inbox
           WHERE phone_number = ? ORDER BY id`,
        )
        .all(SHARED_PHONE) as Array<{
        tenant_id: string;
        message_text: string;
      }>;
    }

    it("routes a message to the tenant that owns the receiving number", async () => {
      const response = await post(
        payload(beta.phoneNumberId, SHARED_PHONE, "hola beta"),
      );

      expect(await statuses(response)).toEqual(["received"]);

      const queued = db
        .prepare(
          "SELECT tenant_id, channel_account_id, message_text FROM message_inbox WHERE phone_number = ?",
        )
        .all(SHARED_PHONE) as Array<{
        tenant_id: string;
        channel_account_id: string;
        message_text: string;
      }>;

      expect(queued).toHaveLength(1);
      expect(queued[0]!.tenant_id).toBe(beta.tenantId);
      expect(queued[0]!.channel_account_id).toBe(beta.channelAccountId);
      expect(queued[0]!.message_text).toBe("hola beta");
    });

    it("routes the same contact to different tenants by phone-number id", async () => {
      await post(payload(alpha.phoneNumberId, SHARED_PHONE, "hola alpha"));
      await post(payload(beta.phoneNumberId, SHARED_PHONE, "hola beta"));

      const byTenant = db
        .prepare(
          "SELECT tenant_id, message_text FROM message_inbox WHERE phone_number = ? ORDER BY id",
        )
        .all(SHARED_PHONE) as Array<{
        tenant_id: string;
        message_text: string;
      }>;

      expect(byTenant).toHaveLength(2);
      expect(byTenant[0]).toEqual({
        tenant_id: alpha.tenantId,
        message_text: "hola alpha",
      });
      expect(byTenant[1]).toEqual({
        tenant_id: beta.tenantId,
        message_text: "hola beta",
      });

      // The inbound log is likewise split by tenant, not merged by phone number.
      expect(MessageStore.getHistory(alphaRef)).toHaveLength(1);
      expect(MessageStore.getHistory(betaRef)).toHaveLength(1);
    });

    it("drops a message for an unknown phone-number id", async () => {
      const response = await post(
        payload("pnid-not-registered", SHARED_PHONE, "hola"),
      );

      expect(await statuses(response)).toEqual(["unknown_channel_account"]);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) as count FROM message_inbox WHERE phone_number = ?",
          )
          .get(SHARED_PHONE),
      ).toEqual({ count: 0 });
    });

    it("drops a message for a disabled channel account", async () => {
      ChannelAccountService.updateStatus(beta.channelAccountId, "disabled");

      const response = await post(
        payload(beta.phoneNumberId, SHARED_PHONE, "hola"),
      );

      expect(await statuses(response)).toEqual(["channel_account_disabled"]);
    });

    /**
     * Regression: only `disabled` was rejected, so a number still being set up
     * accepted messages - stored them, created the conversation, advanced its
     * state - while the send side refuses anything but `active`. The customer
     * got silence from a bot that believed it had answered.
     */
    it("drops a message for a pending channel account", async () => {
      ChannelAccountService.updateStatus(beta.channelAccountId, "pending");

      const response = await post(
        payload(beta.phoneNumberId, SHARED_PHONE, "hola"),
      );

      expect(await statuses(response)).toEqual(["channel_account_pending"]);

      // Nothing was queued for handling and no conversation was started, so
      // there is no state claiming a reply is on its way.
      expect(queued()).toHaveLength(0);
      expect(
        db
          .prepare(
            `SELECT COUNT(*) as count FROM conversations
             WHERE channel_account_id = ? AND phone_number = ?`,
          )
          .get(beta.channelAccountId, SHARED_PHONE),
      ).toEqual({ count: 0 });
    });

    it("ignores a payload with no phone-number id", async () => {
      const body = payload(beta.phoneNumberId, SHARED_PHONE, "hola") as any;
      delete body.entry[0].changes[0].value.metadata;

      const response = await post(body);

      expect(await statuses(response)).toEqual([
        "unroutable_no_phone_number_id",
      ]);
    });

    /**
     * Regression: the parser read `entry[0].changes[0].messages[0]` and dropped
     * everything else in the payload while still answering 200, so Meta never
     * redelivered what was lost. Meta batches because it may: one endpoint now
     * serves every tenant's every number, so a batch spanning two businesses is
     * ordinary traffic rather than an edge case.
     */
    it("delivers every message of a batch spanning two tenants", async () => {
      const response = await post(
        batch([
          {
            phoneNumberId: alpha.phoneNumberId,
            bodies: ["alpha uno", "alpha dos"],
          },
          { phoneNumberId: beta.phoneNumberId, bodies: ["beta uno"] },
        ]),
      );

      expect(await statuses(response)).toEqual([
        "received",
        "received",
        "received",
      ]);

      expect(queued()).toEqual([
        { tenant_id: alpha.tenantId, message_text: "alpha uno" },
        { tenant_id: alpha.tenantId, message_text: "alpha dos" },
        { tenant_id: beta.tenantId, message_text: "beta uno" },
      ]);
    });

    it("delivers the rest of a batch when one number is unknown", async () => {
      const response = await post(
        batch([
          { phoneNumberId: "pnid-not-registered", bodies: ["huérfano"] },
          { phoneNumberId: beta.phoneNumberId, bodies: ["beta uno"] },
        ]),
      );

      expect(await statuses(response)).toEqual([
        "unknown_channel_account",
        "received",
      ]);
      expect(queued()).toEqual([
        { tenant_id: beta.tenantId, message_text: "beta uno" },
      ]);
    });

    it("ignores a message it has already queued", async () => {
      // Meta redelivers a whole batch after a 5xx, so the same message id can
      // arrive twice; the second time there is nothing left to do.
      const body = payload(beta.phoneNumberId, SHARED_PHONE, "hola");

      expect(await statuses(await post(body))).toEqual(["received"]);
      expect(await statuses(await post(body))).toEqual(["duplicate"]);

      expect(queued()).toHaveLength(1);
      expect(MessageStore.getHistory(betaRef)).toHaveLength(1);
    });

    it("stops delivering to a suspended tenant", async () => {
      db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(
        beta.tenantId,
      );

      const response = await post(
        payload(beta.phoneNumberId, SHARED_PHONE, "hola"),
      );

      expect(await statuses(response)).toEqual(["tenant_not_active"]);
      expect(queued()).toEqual([]);
    });
  });
});

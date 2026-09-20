/**
 * Each `*_at` field in packages/types over an INTEGER column reaches the client
 * as a JSON number of milliseconds, or null when a nullable column is unset.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type {
  AnalyticsEvent,
  AuditLog,
  Bundle,
  CatalogPeriod,
  Conversation,
  ConversationMessage,
  Order,
  Product,
  User,
} from "@totem/types";

import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { requireAuth, requireRole } from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import conversationRoutes from "../src/routes/conversations.ts";
import catalogRoutes from "../src/routes/catalog.ts";
import periodRoutes from "../src/routes/periods.ts";
import orderRoutes from "../src/routes/orders.ts";
import analyticsRoutes from "../src/routes/analytics.ts";
import adminUserRoutes from "../src/routes/admin/users.ts";
import adminSystemRoutes from "../src/routes/admin/system.ts";
import { BundleService } from "../src/domains/catalog/bundles.ts";
import { PeriodService } from "../src/domains/catalog/periods.ts";
import { ProductService } from "../src/domains/catalog/products.ts";
import { createOrder, updateOrderStatus } from "../src/domains/orders/write.ts";
import { assignNextAgent } from "../src/domains/conversations/assignment.ts";
import { uploadContract } from "../src/domains/conversations/media.ts";
import { trackEvent } from "../src/domains/analytics/index.ts";
import { logAction } from "../src/platform/audit/logger.ts";
import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";

const PHONE = "51987654321";

/** A seconds value is about 1.8e9, so this bound rejects it as well as text. */
const MILLISECONDS_SINCE_2001 = 1e12;

/** The `number` parameter binds the declared type. A field declared `string` fails to compile at the call. */
function expectMilliseconds(value: number): void {
  expect(typeof value).toBe("number");
  expect(value).toBeGreaterThan(MILLISECONDS_SINCE_2001);
}

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.use("/api/*", requireAuth);
  app.route("/api/conversations", conversationRoutes);
  app.route("/api/catalog", catalogRoutes);
  app.route("/api/periods", periodRoutes);
  app.route("/api/orders", orderRoutes);
  app.route("/api/analytics", analyticsRoutes);
  app.use("/api/admin/*", requireRole("admin"));
  app.route("/api/admin/users", adminUserRoutes);
  app.route("/api/admin", adminSystemRoutes);
  return app;
}

describe("created_at over HTTP", () => {
  let app: ReturnType<typeof buildApp>;
  let tenant: TenantFixture;
  let cookie: string;
  let userId: string;

  beforeEach(() => {
    applySchema();
    app = buildApp();
    tenant = createTenantFixture("created-at");

    const admin = createMember(tenant);
    userId = admin.userId;
    const token = generateSessionToken();
    createSession(token, userId, tenant.tenantId);
    cookie = `session=${token}`;

    insertConversation(tenant.ref(PHONE));
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  async function getJson<T>(path: string): Promise<T> {
    const response = await app.request(path, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    return (await response.json()) as T;
  }

  it("returns CatalogPeriod.created_at as a number", async () => {
    PeriodService.create({
      tenantId: tenant.tenantId,
      name: "Septiembre",
      year_month: "2026-09",
      created_by: null,
    });

    const periods = await getJson<CatalogPeriod[]>("/api/periods");

    expect(periods).toHaveLength(1);
    expectMilliseconds(periods[0]!.created_at);
  });

  it("returns CatalogPeriod.published_at as null until the period is published, then a number", async () => {
    const period = PeriodService.create({
      tenantId: tenant.tenantId,
      name: "Septiembre",
      year_month: "2026-09",
      created_by: null,
    });

    const draft = await getJson<CatalogPeriod>(`/api/periods/${period.id}`);
    expect(draft.published_at).toBeNull();

    PeriodService.updateStatus(tenant.tenantId, period.id, "active");

    const published = await getJson<CatalogPeriod>(`/api/periods/${period.id}`);
    expectMilliseconds(published.published_at!);
  });

  it("returns Product.created_at as a number", async () => {
    ProductService.create({
      id: `prod-${crypto.randomUUID()}`,
      tenantId: tenant.tenantId,
      name: "Cocina",
      category: "cocinas",
    });

    const products = await getJson<Product[]>("/api/catalog/products");

    expect(products).toHaveLength(1);
    expectMilliseconds(products[0]!.created_at);
  });

  it("returns Bundle.created_at as a number", async () => {
    const period = PeriodService.create({
      tenantId: tenant.tenantId,
      name: "Septiembre",
      year_month: "2026-09",
      created_by: null,
    });
    BundleService.create({
      id: `bundle-${crypto.randomUUID()}`,
      tenantId: tenant.tenantId,
      period_id: period.id,
      segment: "gaso",
      name: "Combo",
      price: 1000,
      primary_category: "cocinas",
      categories_json: JSON.stringify(["cocinas"]),
      image_id: `img-${crypto.randomUUID()}`,
      composition_json: JSON.stringify([]),
      installments_json: JSON.stringify([]),
      created_by: null,
    });

    const bundles = await getJson<Bundle[]>(
      `/api/catalog/bundles?period_id=${period.id}`,
    );

    expect(bundles).toHaveLength(1);
    expectMilliseconds(bundles[0]!.created_at);
    expectMilliseconds(bundles[0]!.updated_at);
  });

  it("returns ConversationMessage.created_at as a number", async () => {
    MessageStore.log(tenant.ref(PHONE), "inbound", "text", "hola");

    const detail = await getJson<{ messages: ConversationMessage[] }>(
      `/api/conversations/${PHONE}`,
    );

    expect(detail.messages).toHaveLength(1);
    expectMilliseconds(detail.messages[0]!.created_at);
  });

  it("returns Conversation.assignment_notified_at and recording_uploaded_at as null until they are set", async () => {
    const { conversation } = await getJson<{ conversation: Conversation }>(
      `/api/conversations/${PHONE}`,
    );

    expect(conversation.assignment_notified_at).toBeNull();
    expect(conversation.recording_uploaded_at).toBeNull();
  });

  it("returns Conversation.assignment_notified_at and recording_uploaded_at as numbers once set", async () => {
    const agent = createMember(tenant, "sales_agent");
    await assignNextAgent(tenant.ref(PHONE), "Client");
    await uploadContract({
      ref: tenant.ref(PHONE),
      userId: agent.userId,
      contractFile: new File(["%PDF-1.4"], "contrato.pdf", {
        type: "application/pdf",
      }),
      audioFile: new File(["ID3"], "llamada.mp3", { type: "audio/mpeg" }),
      userDisplayName: "Test User",
    });

    const detail = await getJson<{ conversation: Conversation }>(
      `/api/conversations/${PHONE}`,
    );
    const [listed] = await getJson<Conversation[]>("/api/conversations");

    for (const conversation of [detail.conversation, listed!]) {
      expectMilliseconds(conversation.assignment_notified_at!);
      expectMilliseconds(conversation.recording_uploaded_at!);
    }
  });

  it("returns AnalyticsEvent.created_at as a number", async () => {
    trackEvent(tenant.ref(PHONE), "greeting_sent");

    const { events } = await getJson<{ events: AnalyticsEvent[] }>(
      "/api/analytics/events",
    );
    const inDetail = await getJson<{ events: AnalyticsEvent[] }>(
      `/api/conversations/${PHONE}`,
    );

    expect(events).toHaveLength(1);
    expectMilliseconds(events[0]!.created_at);
    expect(inDetail.events).toHaveLength(1);
    expectMilliseconds(inDetail.events[0]!.created_at);
  });

  it("returns Order.created_at as a number", async () => {
    createOrder({
      ref: tenant.ref(PHONE),
      clientName: "Client",
      clientDni: "87654321",
      products: [{ productId: "p1", name: "Terma", price: 200, quantity: 1 }],
      totalAmount: 200,
      deliveryAddress: "Callao",
    });

    const orders = await getJson<Order[]>("/api/orders");

    expect(orders).toHaveLength(1);
    expectMilliseconds(orders[0]!.created_at);
  });

  it("returns Order.updated_at as a number, before and after a status change", async () => {
    const created = createOrder({
      ref: tenant.ref(PHONE),
      clientName: "Client",
      clientDni: "87654321",
      products: [{ productId: "p1", name: "Terma", price: 200, quantity: 1 }],
      totalAmount: 200,
      deliveryAddress: "Callao",
    });

    const [listed] = await getJson<Order[]>("/api/orders");
    expectMilliseconds(listed!.updated_at);

    updateOrderStatus(tenant.tenantId, created.id, "supervisor_approved");

    const changed = await getJson<Order>(`/api/orders/${created.id}`);
    expectMilliseconds(changed.updated_at);
  });

  it("returns AuditLog.created_at as a number", async () => {
    logAction({ userId, tenantId: tenant.tenantId }, "test_action", "test");

    const { logs } = await getJson<{ logs: AuditLog[] }>("/api/admin/audit");

    expect(logs).toHaveLength(1);
    expectMilliseconds(logs[0]!.created_at);
  });

  it("returns User.created_at as a number", async () => {
    const { users } = await getJson<{ users: Array<Pick<User, "created_at">> }>(
      "/api/admin/users",
    );

    expect(users).toHaveLength(1);
    expectMilliseconds(users[0]!.created_at);
  });
});

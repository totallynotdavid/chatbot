/**
 * A simulated product image is logged the way a real send logs it: the media
 * path as content and the product id on the row, so the dashboard shows the
 * product's picture through its ordinary `/media/<content>` render.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";

import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { db } from "../src/db/index.ts";
import { BundleService } from "../src/domains/catalog/index.ts";
import { sendBundleImages } from "../src/conversation/images.ts";
import { requireAuth } from "../src/middleware/auth.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import simulatorRoutes from "../src/routes/simulator.ts";

describe("simulated product images", () => {
  let app: Hono;
  let tenant: TenantFixture;
  let headers: Record<string, string>;
  let bundleId: string;

  beforeEach(() => {
    applySchema();

    app = new Hono();
    app.use("/api/*", requireAuth);
    app.route("/api/simulator", simulatorRoutes);

    tenant = createTenantFixture("sim-images");
    const token = generateSessionToken();
    createSession(token, createMember(tenant, "admin").userId, tenant.tenantId);
    headers = {
      Cookie: `session=${token}`,
      "Content-Type": "application/json",
    };

    const periodId = `per-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO catalog_periods (id, tenant_id, name, year_month, status)
       VALUES (?, ?, 'Enero', '2026-01', 'active')`,
    ).run(periodId, tenant.tenantId);

    bundleId = `bundle-${crypto.randomUUID()}`;
    BundleService.create({
      id: bundleId,
      tenantId: tenant.tenantId,
      period_id: periodId,
      segment: "fnb",
      name: "Cocina 2 hornillas",
      price: 800,
      primary_category: "cocinas",
      categories_json: JSON.stringify(["cocinas"]),
      image_id: "cocina-2h",
      composition_json: JSON.stringify({ fixed: [], choices: [] }),
      installments_json: JSON.stringify([{ months: 12, monthlyAmount: 80 }]),
      created_by: null,
    });
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  it("stores the media path and the product, not the caption", async () => {
    const created = await app.request("/api/simulator/conversations", {
      method: "POST",
      headers,
      body: "{}",
    });
    const conversation = (await created.json()) as { phone_number: string };

    await sendBundleImages({
      ref: tenant.ref(conversation.phone_number),
      segment: "fnb",
      creditLine: 5000,
      isSimulation: true,
    });

    const thread = await app.request(
      `/api/simulator/conversation/${conversation.phone_number}`,
      { headers },
    );
    const { messages } = (await thread.json()) as {
      messages: { type: string; content: string; product_id: string | null }[];
    };
    const image = messages.find((m) => m.type === "image");

    expect(image?.content).toBe("images/cocina-2h.jpg");
    expect(image?.product_id).toBe(bundleId);
  });
});

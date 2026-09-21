/**
 * The stock badge on a bundle card changes the bundle's stock status. The call
 * it makes has to land on a route that updates a bundle, as the browser makes
 * it: a relative URL under `/api`, with the session cookie.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { requireAuth } from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import { BundleService } from "../src/domains/catalog/bundles.ts";
import catalogRoutes from "../src/routes/catalog.ts";

// Loaded by a computed path: the SvelteKit workspace is outside this project's
// tsc rootDir.
const CATALOG_PATH = "../../frontend/src/lib/utils/catalog.ts";
const { updateBundleStock } = (await import(CATALOG_PATH)) as {
  updateBundleStock: (
    bundleId: string,
    stockStatus: "in_stock" | "low_stock" | "out_of_stock",
  ) => Promise<unknown>;
};

const realFetch = globalThis.fetch;

describe("changing a bundle's stock from the dashboard", () => {
  let tenant: TenantFixture;
  let bundleId: string;

  beforeEach(() => {
    applySchema();
    const app = new Hono();
    app.use("/api/*", requireAuth);
    app.route("/api/catalog", catalogRoutes);
    app.onError(errorHandler);

    tenant = createTenantFixture("bundle-stock");
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
      segment: "gaso",
      name: "Cocina",
      price: 999,
      primary_category: "cocinas",
      categories_json: "[]",
      image_id: "img-1",
      composition_json: "{}",
      installments_json: "[]",
      created_by: null,
    });

    const { userId } = createMember(tenant, "supervisor");
    const token = generateSessionToken();
    createSession(token, userId, tenant.tenantId);

    // The browser resolves the relative URL against the dashboard, which
    // forwards it to the backend, and adds the session cookie itself.
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
      app.request(String(input), {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string>),
          Cookie: `session=${token}`,
        },
      })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    dropTenantFixture(tenant);
  });

  it("stores the new stock status", async () => {
    await updateBundleStock(bundleId, "out_of_stock");

    expect(BundleService.getById(tenant.tenantId, bundleId)?.stock_status).toBe(
      "out_of_stock",
    );
  });

  it("takes the bundle out of what the bot offers", async () => {
    await updateBundleStock(bundleId, "out_of_stock");

    expect(
      BundleService.getAvailable(tenant.tenantId).map((b) => b.id),
    ).toEqual([]);
  });
});

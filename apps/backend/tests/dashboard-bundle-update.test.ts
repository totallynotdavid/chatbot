/**
 * The bundle editor sends a bundle's category, composition and installments
 * with the name and price. The update route has to store them, and refuse the
 * values the create route would refuse, so an edit cannot leave a bundle the
 * bot cannot read.
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

const COMPOSITION = JSON.stringify({
  fixed: [{ id: "prod-1", name: "Cocina 4Q", specs: {} }],
  choices: [],
});
const INSTALLMENTS = JSON.stringify([
  { months: 12, monthlyAmount: 150, totalAmount: 1800 },
]);

describe("editing a bundle", () => {
  let app: Hono;
  let tenant: TenantFixture;
  let auth: { Cookie: string };
  let periodId: string;
  let bundleId: string;

  const patch = (body: unknown) =>
    app.request(`/api/catalog/bundles/${bundleId}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const stored = () => BundleService.getById(tenant.tenantId, bundleId)!;

  beforeEach(() => {
    applySchema();
    app = new Hono();
    app.use("/api/*", requireAuth);
    app.route("/api/catalog", catalogRoutes);
    app.onError(errorHandler);

    tenant = createTenantFixture("bundle-update");
    periodId = `per-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO catalog_periods (id, tenant_id, name, year_month, status)
       VALUES (?, ?, 'Enero', '2026-01', 'draft')`,
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
      composition_json: JSON.stringify({ fixed: [], choices: [] }),
      installments_json: "[]",
      created_by: null,
    });

    const { userId } = createMember(tenant, "admin");
    const token = generateSessionToken();
    createSession(token, userId, tenant.tenantId);
    auth = { Cookie: `session=${token}` };
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  it("stores the category, composition and installments the editor sends", async () => {
    const response = await patch({
      name: "Cocina + Licuadora",
      price: 1200,
      primary_category: "combos",
      composition_json: COMPOSITION,
      installments_json: INSTALLMENTS,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.primary_category).toBe("combos");
    expect(body.composition_json).toBe(COMPOSITION);
    expect(body.installments_json).toBe(INSTALLMENTS);
    expect(stored()).toMatchObject({
      name: "Cocina + Licuadora",
      price: 1200,
      primary_category: "combos",
      composition_json: COMPOSITION,
      installments_json: INSTALLMENTS,
    });
  });

  it("leaves the fields the request does not name alone", async () => {
    await patch({ primary_category: "combos" });

    expect(stored()).toMatchObject({
      name: "Cocina",
      primary_category: "combos",
      installments_json: "[]",
    });
  });

  it("refuses an empty category and stores nothing", async () => {
    const response = await patch({ name: "Nuevo", primary_category: " " });

    expect(response.status).toBe(400);
    expect(stored()).toMatchObject({
      name: "Cocina",
      primary_category: "cocinas",
    });
  });

  it("refuses JSON that does not parse and stores nothing", async () => {
    const response = await patch({
      name: "Nuevo",
      installments_json: "[{months:",
    });

    expect(response.status).toBe(400);
    expect(stored()).toMatchObject({ name: "Cocina", installments_json: "[]" });
  });

  it("refuses a JSON value the bot cannot read installments from", async () => {
    for (const installments of ["null", "7", '"12"']) {
      const response = await patch({ installments_json: installments });
      expect(response.status).toBe(400);
    }
    expect(stored().installments_json).toBe("[]");
  });

  it("refuses a composition that is not text", async () => {
    const response = await patch({ composition_json: { fixed: [] } });

    expect(response.status).toBe(400);
  });

  it.each([
    ["stock_status", "sold_out"],
    ["stock_status", 3],
    ["is_active", 2],
    ["is_active", "yes"],
    ["is_active", true],
    ["price", "999"],
    ["price", -5],
    ["price", 0],
    ["price", null],
    ["name", ""],
    ["name", null],
    ["notes", 7],
  ])("refuses %s %p and stores none of the request", async (field, value) => {
    const before = stored();

    const response = await patch({
      name: "Nuevo",
      primary_category: "combos",
      [field]: value,
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain(
      field,
    );
    expect(stored()).toEqual(before);
  });

  it("stores a valid stock status, activity flag, price and notes", async () => {
    const response = await patch({
      stock_status: "low_stock",
      is_active: 0,
      price: 1500.5,
      notes: "Sin garantía",
    });

    expect(response.status).toBe(200);
    expect(stored()).toMatchObject({
      stock_status: "low_stock",
      is_active: 0,
      price: 1500.5,
      notes: "Sin garantía",
    });
  });

  it("refuses a body that is not a JSON object", async () => {
    for (const raw of ["[]", "7", "null", "{not json"]) {
      const response = await app.request(`/api/catalog/bundles/${bundleId}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: raw,
      });
      expect(response.status).toBe(400);
    }
  });

  describe("editing many bundles", () => {
    const bulk = (body: unknown) =>
      app.request("/api/catalog/bundles/bulk-update", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it("stores a valid update on every bundle named", async () => {
      const response = await bulk({
        ids: [bundleId],
        updates: { stock_status: "out_of_stock", is_active: 0 },
      });

      expect(response.status).toBe(200);
      expect(stored()).toMatchObject({
        stock_status: "out_of_stock",
        is_active: 0,
      });
    });

    it.each([
      [{ stock_status: "sold_out" }],
      [{ is_active: 5 }],
      ["out_of_stock"],
      [null],
      [[]],
      [{}],
      [{ price: 1 }],
    ])("refuses updates %p", async (updates) => {
      const before = stored();

      const response = await bulk({ ids: [bundleId], updates });

      expect(response.status).toBe(400);
      expect(stored()).toEqual(before);
    });

    it.each([[[]], [[7]], ["a"]])("refuses ids %p", async (ids) => {
      const response = await bulk({ ids, updates: { is_active: 0 } });

      expect(response.status).toBe(400);
    });
  });

  it("holds the create route to the same rule", async () => {
    const form = new FormData();
    form.append("image", new File([new Uint8Array([0xff, 0xd8])], "a.jpg"));
    form.append("period_id", periodId);
    form.append("name", "Roto");
    form.append("price", "100");
    form.append("primary_category", "cocinas");
    form.append("composition_json", "not json");
    form.append("installments_json", INSTALLMENTS);

    const response = await app.request("/api/catalog/bundles", {
      method: "POST",
      headers: auth,
      body: form,
    });

    expect(response.status).toBe(400);
    expect(
      BundleService.getByPeriod(tenant.tenantId, periodId).map((b) => b.name),
    ).toEqual(["Cocina"]);
  });

  it.each([
    ["price", "abc"],
    ["price", "0"],
    ["segment", "retail"],
  ])("refuses a new bundle with %s %p", async (field, value) => {
    const form = new FormData();
    form.append("image", new File([new Uint8Array([0xff, 0xd8])], "a.jpg"));
    form.append("period_id", periodId);
    form.append("name", "Roto");
    form.append("price", "100");
    form.append("primary_category", "cocinas");
    form.append("composition_json", COMPOSITION);
    form.append("installments_json", INSTALLMENTS);
    form.set(field, value);

    const response = await app.request("/api/catalog/bundles", {
      method: "POST",
      headers: auth,
      body: form,
    });

    expect(response.status).toBe(400);
  });
});

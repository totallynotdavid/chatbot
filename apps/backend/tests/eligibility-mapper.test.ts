/**
 * Turning a provider verdict into an enrichment result.
 *
 * The catalog half of that answer belongs to a tenant: which bundles somebody's
 * credit line reaches is a question about one business's stock. Only one caller
 * has no tenant - GET /api/providers/:dni, the operator's provider diagnostic,
 * which has no conversation behind it - and it used to be handed down as the
 * empty string.
 *
 * That string reached `WHERE b.tenant_id = ?`, matched no tenant, and came back
 * empty. So an eligible DNI checked through that endpoint reported "eligible,
 * and nothing is affordable" no matter what the catalog actually held, and
 * nothing distinguished that from a business whose catalog really was empty.
 * No tenant is null here, as everywhere else in this codebase, and the absence
 * of a catalog answer is stated rather than faked.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { db } from "../src/db/index.ts";
import { mapEligibilityToEnrichment } from "../src/domains/eligibility/mapper.ts";

const CREDIT = 5000;

describe("mapping an eligible customer", () => {
  let tenant: TenantFixture;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("eligibility-mapper");

    const periodId = `period-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO catalog_periods (id, tenant_id, name, year_month, status)
       VALUES (?, ?, 'Septiembre', ?, 'active')`,
    ).run(periodId, tenant.tenantId, `2026-${crypto.randomUUID().slice(0, 2)}`);

    db.prepare(
      `INSERT INTO catalog_bundles
         (id, tenant_id, period_id, segment, name, price, primary_category,
          image_id, composition_json, installments_json)
       VALUES (?, ?, ?, 'fnb', 'Combo Cocina', 1200, 'cocinas', 'img1', '{}', '[]')`,
    ).run(`bundle-${crypto.randomUUID()}`, tenant.tenantId, periodId);
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  const eligible = { eligible: true, credit: CREDIT, name: "Juan" };

  it("answers with the tenant's catalog when one owns the check", () => {
    const result = mapEligibilityToEnrichment(tenant.tenantId, eligible);

    expect(result.status).toBe("eligible");
    expect(result.catalogChecked).toBe(true);
    expect(result.affordableCategories).toEqual(["cocinas"]);
    expect(result.affordableBundles).toHaveLength(1);
  });

  /**
   * The regression. With the empty string this returned status "eligible" and
   * `affordableCategories: []` - the same shape as the real answer above, and
   * indistinguishable from a business with nothing in stock.
   */
  it("does not claim an empty catalog when no tenant owns the check", () => {
    const result = mapEligibilityToEnrichment(null, eligible);

    expect(result.status).toBe("eligible");
    expect(result.credit).toBe(CREDIT);
    expect(result.name).toBe("Juan");

    // Nothing was asked, so nothing is answered - rather than an empty list
    // that reads as an answer.
    expect(result.catalogChecked).toBe(false);
    expect(result.affordableCategories).toBeUndefined();
    expect(result.affordableBundles).toBeUndefined();
    expect(result.categoryDisplayNames).toBeUndefined();
    expect(result.groupDisplayNames).toBeUndefined();
  });

  it("still reports the segment and whether an age is needed", () => {
    // These come from the provider verdict, not the catalog, so the tenant-less
    // answer keeps them.
    const result = mapEligibilityToEnrichment(null, {
      eligible: true,
      credit: CREDIT,
      nse: 3,
    });

    expect(result.segment).toBe("gaso");
    expect(result.requiresAge).toBe(true);
    expect(result.nse).toBe(3);
  });

  it("needs no tenant to report a customer who is not eligible", () => {
    expect(
      mapEligibilityToEnrichment(null, { eligible: false, credit: 0 }).status,
    ).toBe("not_eligible");
  });

  it("needs no tenant to report an outage", () => {
    expect(
      mapEligibilityToEnrichment(null, {
        eligible: false,
        credit: 0,
        needsHuman: true,
        handoffReason: "both_providers_down",
      }).status,
    ).toBe("system_outage");
  });
});

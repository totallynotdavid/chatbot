/**
 * A tenant's catalog is seeded from the same base data as every other seeded
 * tenant's, so two tenants' seeded bundles name the same `image_id`. The bundle
 * and asset rows are tenant-scoped, but the image file is shared. Deleting a
 * bundle must keep a file that another tenant's bundle still names.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { db } from "../src/db/index.ts";
import { imageStorage } from "../src/adapters/storage/images.ts";
import { IMAGES_DIR } from "../src/lib/storage-paths.ts";
import { AssetService } from "../src/domains/assets/index.ts";
import { BundleService } from "../src/domains/catalog/bundles.ts";

const written: string[] = [];

/** The bytes a seeded catalog ships with, as a file the storage can find. */
function writeImage(imageId: string): string {
  // Uses the store's own root. A separate copy of the path could drift and let
  // the deletion assertions pass against a directory the store never reads.
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  fs.writeFileSync(path.join(IMAGES_DIR, `${imageId}.jpg`), "jpeg-bytes");
  written.push(imageId);
  return imageId;
}

/** One tenant's copy of a base-catalog bundle, image id and all. */
function seedBundle(fixture: TenantFixture, imageId: string): string {
  const periodId = `per-${crypto.randomUUID()}`;

  db.prepare(
    `INSERT INTO catalog_periods (id, tenant_id, name, year_month, status)
     VALUES (?, ?, 'Enero', '2026-01', 'active')`,
  ).run(periodId, fixture.tenantId);

  const bundleId = `bundle-${crypto.randomUUID()}`;

  BundleService.create({
    id: bundleId,
    tenantId: fixture.tenantId,
    period_id: periodId,
    segment: "gaso",
    name: "Celular a elección + Cocineta 2Q",
    price: 1799,
    primary_category: "celulares",
    categories_json: JSON.stringify(["celulares"]),
    image_id: imageId,
    composition_json: JSON.stringify({ fixed: [], choices: [] }),
    installments_json: JSON.stringify({ "3m": 643.3 }),
    created_by: null,
  });

  return bundleId;
}

describe("a catalog image two tenants were seeded with", () => {
  let alpha: TenantFixture;
  let beta: TenantFixture;
  let sharedImage: string;
  let alphaBundle: string;
  let betaBundle: string;

  beforeEach(() => {
    applySchema();

    alpha = createTenantFixture("alpha-images");
    beta = createTenantFixture("beta-images");

    sharedImage = writeImage(
      crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    );
    alphaBundle = seedBundle(alpha, sharedImage);
    betaBundle = seedBundle(beta, sharedImage);
  });

  afterEach(() => {
    for (const imageId of written.splice(0)) {
      fs.rmSync(path.join(IMAGES_DIR, `${imageId}.jpg`), { force: true });
    }
    dropTenantFixture(alpha);
    dropTenantFixture(beta);
  });

  it("survives one tenant replacing its own bundle image", async () => {
    const replacement = writeImage("aaaa1111bbbb2222");

    await BundleService.updateImage(alpha.tenantId, alphaBundle, replacement);

    expect(await imageStorage.exists(sharedImage)).toBe(true);
    expect(BundleService.getById(beta.tenantId, betaBundle)?.image_id).toBe(
      sharedImage,
    );
    expect(BundleService.getById(alpha.tenantId, alphaBundle)?.image_id).toBe(
      replacement,
    );
  });

  it("survives one tenant deleting its own bundle", async () => {
    await BundleService.delete(alpha.tenantId, alphaBundle);

    expect(await imageStorage.exists(sharedImage)).toBe(true);
    expect(BundleService.getById(beta.tenantId, betaBundle)).not.toBeNull();
  });

  it("is deleted with the last bundle that still points at it", async () => {
    await BundleService.delete(alpha.tenantId, alphaBundle);
    await BundleService.delete(beta.tenantId, betaBundle);

    expect(await imageStorage.exists(sharedImage)).toBe(false);
  });

  it("takes only the deleting tenant's asset row with it", async () => {
    const storageKey = imageStorage.storageKey(sharedImage);

    for (const tenant of [alpha, beta]) {
      AssetService.create({
        tenantId: tenant.tenantId,
        kind: "catalog_image",
        visibility: "public",
        storageKey,
      });
    }

    await BundleService.delete(alpha.tenantId, alphaBundle);

    expect(AssetService.getByStorageKey(alpha.tenantId, storageKey)).toBeNull();
    expect(
      AssetService.getByStorageKey(beta.tenantId, storageKey),
    ).not.toBeNull();
  });
});

describe("a catalog image only one tenant has", () => {
  let alpha: TenantFixture;
  let ownImage: string;
  let bundleId: string;

  beforeEach(() => {
    applySchema();
    alpha = createTenantFixture("solo-images");
    ownImage = writeImage(crypto.randomUUID().replace(/-/g, "").slice(0, 16));
    bundleId = seedBundle(alpha, ownImage);
  });

  afterEach(() => {
    for (const imageId of written.splice(0)) {
      fs.rmSync(path.join(IMAGES_DIR, `${imageId}.jpg`), { force: true });
    }
    dropTenantFixture(alpha);
  });

  it("is deleted when its bundle is", async () => {
    await BundleService.delete(alpha.tenantId, bundleId);

    expect(await imageStorage.exists(ownImage)).toBe(false);
  });

  it("is deleted when its bundle is given a new one", async () => {
    const replacement = writeImage("cccc3333dddd4444");

    await BundleService.updateImage(alpha.tenantId, bundleId, replacement);

    expect(await imageStorage.exists(ownImage)).toBe(false);
    expect(await imageStorage.exists(replacement)).toBe(true);
  });
});

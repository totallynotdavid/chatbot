import { Hono } from "hono";
import { pathParam } from "../lib/http.ts";
import {
  ProductService,
  BundleService,
  bundleFieldsError,
} from "../domains/catalog/index.ts";
import { PeriodService } from "../domains/catalog/periods.ts";
import { imageStorage } from "../adapters/storage/images.ts";
import { AssetService } from "../domains/assets/index.ts";
import { logAction } from "../platform/audit/logger.ts";
import {
  activeTenantId,
  requireActiveTenant,
  requireRole,
  requireTenantScope,
} from "../middleware/auth.ts";

const catalog = new Hono();

const requireCatalogWrite = requireRole("admin", "developer", "supervisor");

// Reads use the pinned tenant, or every open tenant for an unpinned platform
// operator. Writes additionally need a pinned tenant to write into.
catalog.use("/*", requireTenantScope);

// ============ PRODUCTS (base templates) ============

catalog.get("/products", (c) => {
  return c.json(ProductService.getAll(c.get("scope").tenantId));
});

catalog.get("/products/categories", (c) => {
  return c.json(ProductService.getCategories(c.get("scope").tenantId));
});

catalog.get("/products/:id", (c) => {
  const product = ProductService.getById(
    c.get("scope").tenantId,
    pathParam(c, "id"),
  );
  if (!product) return c.json({ error: "Product not found" }, 404);
  return c.json(product);
});

catalog.post(
  "/products",
  requireActiveTenant,
  requireCatalogWrite,
  async (c) => {
    const user = c.get("user");
    const tenantId = activeTenantId(c);
    const { name, category, brand, model, specs_json } = await c.req.json();

    if (!name || !category) {
      return c.json({ error: "Name and category required" }, 400);
    }

    const id = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const product = ProductService.create({
      id,
      tenantId,
      name,
      category,
      brand,
      model,
      specs_json,
    });

    logAction({ userId: user.id, tenantId }, "create_product", "product", id, {
      name,
      category,
    });
    return c.json(product);
  },
);

catalog.patch(
  "/products/:id",
  requireActiveTenant,
  requireCatalogWrite,
  async (c) => {
    const id = pathParam(c, "id");
    const user = c.get("user");
    const tenantId = activeTenantId(c);
    const updates = await c.req.json();

    const product = ProductService.update(tenantId, id, updates);
    if (!product) return c.json({ error: "Product not found" }, 404);

    logAction(
      { userId: user.id, tenantId },
      "update_product",
      "product",
      id,
      updates,
    );
    return c.json(product);
  },
);

// ============ BUNDLES ============

catalog.get("/bundles", (c) => {
  const scope = c.get("scope");
  const periodId = c.req.query("period_id");
  const maxPrice = c.req.query("max_price");
  const category = c.req.query("category");
  const segment = c.req.query("segment") as "gaso" | "fnb" | undefined;

  if (periodId) {
    return c.json(BundleService.getByPeriod(scope.tenantId, periodId, segment));
  }

  if (!scope.tenantId) {
    // "Currently available" only means something inside one tenant's active
    // period, so an unpinned platform operator must select a tenant first.
    return c.json(
      { error: "Select a tenant, or pass period_id, to list bundles" },
      400,
    );
  }

  return c.json(
    BundleService.getAvailable(scope.tenantId, {
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      category: category || undefined,
      segment,
    }),
  );
});

catalog.get("/bundles/categories", requireActiveTenant, (c) => {
  const segment = c.req.query("segment") as "gaso" | "fnb" | undefined;
  return c.json(
    BundleService.getAvailableCategories(activeTenantId(c), segment),
  );
});

catalog.get("/bundles/:id", (c) => {
  const bundle = BundleService.getById(
    c.get("scope").tenantId,
    pathParam(c, "id"),
  );
  if (!bundle) return c.json({ error: "Bundle not found" }, 404);
  return c.json(bundle);
});

catalog.post(
  "/bundles",
  requireActiveTenant,
  requireCatalogWrite,
  async (c) => {
    const user = c.get("user");
    const tenantId = activeTenantId(c);
    const body = await c.req.parseBody();

    const file = body.image as File;
    if (!file) return c.json({ error: "Image required" }, 400);

    const periodId = body.period_id as string;
    const segment = (body.segment as string) || "gaso";
    const name = body.name as string;
    const price = body.price as string;
    const primaryCategory = body.primary_category as string;
    const categoriesJson = body.categories_json as string;
    const compositionJson = body.composition_json as string;
    const installmentsJson = body.installments_json as string;

    if (
      !periodId ||
      !name ||
      !price ||
      !primaryCategory ||
      !compositionJson ||
      !installmentsJson
    ) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const fieldsError = bundleFieldsError({
      primary_category: primaryCategory,
      composition_json: compositionJson,
      installments_json: installmentsJson,
    });
    if (fieldsError) return c.json({ error: fieldsError }, 400);

    const period = PeriodService.getById(tenantId, periodId);
    if (!period) return c.json({ error: "Period not found" }, 404);
    if (period.status !== "draft") {
      return c.json({ error: "Can only add bundles to draft periods" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const imageId = await imageStorage.store(buffer);

    // Catalog images are public by design because Meta fetches them when we
    // send an image message. The asset row still records who owns them.
    AssetService.create({
      tenantId,
      kind: "catalog_image",
      visibility: "public",
      storageKey: imageStorage.storageKey(imageId),
      contentType: "image/jpeg",
      byteSize: buffer.byteLength,
      createdBy: user.id,
    });

    const id = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bundle = BundleService.create({
      id,
      tenantId,
      period_id: periodId,
      segment: segment as "gaso" | "fnb",
      name,
      price: parseFloat(price),
      primary_category: primaryCategory,
      categories_json: categoriesJson || "[]",
      image_id: imageId,
      composition_json: compositionJson,
      installments_json: installmentsJson,
      created_by: user.id,
    });

    logAction({ userId: user.id, tenantId }, "create_bundle", "bundle", id, {
      name,
      price,
      primaryCategory,
      segment,
    });
    return c.json(bundle);
  },
);

catalog.patch(
  "/bundles/:id",
  requireActiveTenant,
  requireCatalogWrite,
  async (c) => {
    const id = pathParam(c, "id");
    const user = c.get("user");
    const tenantId = activeTenantId(c);
    const updates = await c.req.json();

    const fieldsError = bundleFieldsError(updates ?? {});
    if (fieldsError) return c.json({ error: fieldsError }, 400);

    const bundle = BundleService.update(tenantId, id, updates);
    if (!bundle) return c.json({ error: "Bundle not found" }, 404);

    logAction(
      { userId: user.id, tenantId },
      "update_bundle",
      "bundle",
      id,
      updates,
    );
    return c.json(bundle);
  },
);

catalog.post(
  "/bundles/:id/image",
  requireActiveTenant,
  requireCatalogWrite,
  async (c) => {
    const id = pathParam(c, "id");
    const user = c.get("user");
    const tenantId = activeTenantId(c);
    const body = await c.req.parseBody();

    const file = body.image as File;
    if (!file) return c.json({ error: "Image required" }, 400);

    const existing = BundleService.getById(tenantId, id);
    if (!existing) return c.json({ error: "Bundle not found" }, 404);

    const period = PeriodService.getById(tenantId, existing.period_id);
    if (period && period.status !== "draft") {
      return c.json({ error: "Can only edit bundles in draft periods" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const imageId = await imageStorage.store(buffer);

    AssetService.create({
      tenantId,
      kind: "catalog_image",
      visibility: "public",
      storageKey: imageStorage.storageKey(imageId),
      contentType: "image/jpeg",
      byteSize: buffer.byteLength,
      createdBy: user.id,
    });

    const bundle = await BundleService.updateImage(tenantId, id, imageId);

    logAction(
      { userId: user.id, tenantId },
      "update_bundle_image",
      "bundle",
      id,
    );
    return c.json(bundle);
  },
);

catalog.delete(
  "/bundles/:id",
  requireActiveTenant,
  requireCatalogWrite,
  async (c) => {
    const id = pathParam(c, "id");
    const user = c.get("user");
    const tenantId = activeTenantId(c);

    if (!BundleService.getById(tenantId, id)) {
      return c.json({ error: "Bundle not found" }, 404);
    }

    await BundleService.delete(tenantId, id);
    logAction({ userId: user.id, tenantId }, "delete_bundle", "bundle", id);
    return c.json({ success: true });
  },
);

catalog.post(
  "/bundles/bulk-update",
  requireActiveTenant,
  requireCatalogWrite,
  async (c) => {
    const user = c.get("user");
    const tenantId = activeTenantId(c);
    const { ids, updates } = await c.req.json();

    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ids must be non-empty array" }, 400);
    }

    const count = BundleService.bulkUpdate(tenantId, ids, updates);
    logAction(
      { userId: user.id, tenantId },
      "bulk_update_bundles",
      "bundle",
      null,
      { count, ids, updates },
    );
    return c.json({ success: true, count });
  },
);

export default catalog;

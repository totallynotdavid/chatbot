import { Hono } from "hono";
import { ProductService, BundleService } from "../services/catalog/index.ts";
import { PeriodService } from "../services/periods.ts";
import { imageStorage } from "../services/image-storage.ts";
import { logAction } from "../services/audit.ts";
import { requireRole } from "../middleware/auth.ts";

const catalog = new Hono();

const requireCatalogWrite = requireRole("admin", "developer", "supervisor");

// ============ PRODUCTS (base templates) ============

catalog.get("/products", (c) => {
  return c.json(ProductService.getAll());
});

catalog.get("/products/categories", (c) => {
  return c.json(ProductService.getCategories());
});

catalog.get("/products/:id", (c) => {
  const product = ProductService.getById(c.req.param("id"));
  if (!product) return c.json({ error: "Product not found" }, 404);
  return c.json(product);
});

catalog.post("/products", requireCatalogWrite, async (c) => {
  const user = c.get("user");
  const { name, category, brand, model, specs_json } = await c.req.json();

  if (!name || !category) {
    return c.json({ error: "Name and category required" }, 400);
  }

  const id = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const product = ProductService.create({
    id,
    name,
    category,
    brand,
    model,
    specs_json,
  });

  logAction(user.id, "create_product", "product", id, { name, category });
  return c.json(product);
});

catalog.patch("/products/:id", requireCatalogWrite, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const updates = await c.req.json();

  const product = ProductService.update(id, updates);
  logAction(user.id, "update_product", "product", id, updates);
  return c.json(product);
});

// ============ BUNDLES ============

catalog.get("/bundles", (c) => {
  const periodId = c.req.query("period_id");
  const maxPrice = c.req.query("max_price");
  const category = c.req.query("category");
  const segment = c.req.query("segment") as "gaso" | "fnb" | undefined;

  if (periodId) {
    return c.json(BundleService.getByPeriod(periodId, segment));
  }

  return c.json(
    BundleService.getAvailable({
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      category: category || undefined,
      segment,
    }),
  );
});

catalog.get("/bundles/categories", (c) => {
  const segment = c.req.query("segment") as "gaso" | "fnb" | undefined;
  return c.json(BundleService.getAvailableCategories(segment));
});

catalog.get("/bundles/:id", (c) => {
  const bundle = BundleService.getById(c.req.param("id"));
  if (!bundle) return c.json({ error: "Bundle not found" }, 404);
  return c.json(bundle);
});

catalog.post("/bundles", requireCatalogWrite, async (c) => {
  const user = c.get("user");
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

  const period = PeriodService.getById(periodId);
  if (!period) return c.json({ error: "Period not found" }, 404);
  if (period.status !== "draft") {
    return c.json({ error: "Can only add bundles to draft periods" }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const imageId = await imageStorage.store(buffer);

  const id = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const bundle = BundleService.create({
    id,
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

  logAction(user.id, "create_bundle", "bundle", id, {
    name,
    price,
    primaryCategory,
    segment,
  });
  return c.json(bundle);
});

catalog.patch("/bundles/:id", requireCatalogWrite, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const updates = await c.req.json();

  const bundle = BundleService.update(id, updates);
  logAction(user.id, "update_bundle", "bundle", id, updates);
  return c.json(bundle);
});

catalog.post("/bundles/:id/image", requireCatalogWrite, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const body = await c.req.parseBody();

  const file = body.image as File;
  if (!file) return c.json({ error: "Image required" }, 400);

  const existing = BundleService.getById(id);
  if (!existing) return c.json({ error: "Bundle not found" }, 404);

  const period = PeriodService.getById(existing.period_id);
  if (period && period.status !== "draft") {
    return c.json({ error: "Can only edit bundles in draft periods" }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const imageId = await imageStorage.store(buffer);
  const bundle = await BundleService.updateImage(id, imageId);

  logAction(user.id, "update_bundle_image", "bundle", id);
  return c.json(bundle);
});

catalog.delete("/bundles/:id", requireCatalogWrite, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  await BundleService.delete(id);
  logAction(user.id, "delete_bundle", "bundle", id);
  return c.json({ success: true });
});

catalog.post("/bundles/bulk-update", requireCatalogWrite, async (c) => {
  const user = c.get("user");
  const { ids, updates } = await c.req.json();

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: "ids must be non-empty array" }, 400);
  }

  const count = BundleService.bulkUpdate(ids, updates);
  logAction(user.id, "bulk_update_bundles", "bundle", null, {
    count,
    ids,
    updates,
  });
  return c.json({ success: true, count });
});

export default catalog;

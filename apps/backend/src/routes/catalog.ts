import { Hono } from "hono";
import { CatalogService } from "../services/catalog.ts";
import { BulkImportService } from "../services/bulk-import.ts";
import { extractProductData } from "../services/vision-extractor.ts";
import { logAction } from "../services/audit.ts";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const catalog = new Hono();

// List all products
catalog.get("/", (c) => {
  const segment = c.req.query("segment");

  if (segment && (segment === "fnb" || segment === "gaso")) {
    return c.json(CatalogService.getBySegment(segment));
  }

  return c.json(CatalogService.getAll());
});

// Create product with image
catalog.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();

  const file = body.image as File;
  if (!file) {
    return c.json({ error: "Image required" }, 400);
  }

  const segment = body.segment as string;
  const category = body.category as string;
  const name = body.name as string;
  const price = body.price as string;
  const installments = body.installments as string;

  if (!segment || !category || !name || !price) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  // Optimize main image
  const buffer = await file.arrayBuffer();
  const optimized = await sharp(Buffer.from(buffer))
    .resize(1024, 1024, { fit: "inside" })
    .jpeg({ quality: 85 })
    .toBuffer();

  // Save main image
  const fileName = `${Date.now()}_${file.name.replace(/\.[^.]+$/, "")}.jpg`;
  const dir = path.join(process.cwd(), "data", "uploads", "catalog", segment, category);
  fs.mkdirSync(dir, { recursive: true });
  await Bun.write(path.join(dir, fileName), optimized);

  // Handle specs image if provided
  let specsPath: string | null = null;
  const specsFile = body.specsImage as File | undefined;
  if (specsFile) {
    const specsBuffer = await specsFile.arrayBuffer();
    const specsOptimized = await sharp(Buffer.from(specsBuffer))
      .resize(1024, 1024, { fit: "inside" })
      .jpeg({ quality: 85 })
      .toBuffer();
    
    const specsFileName = `${Date.now()}_specs_${specsFile.name.replace(/\.[^.]+$/, "")}.jpg`;
    await Bun.write(path.join(dir, specsFileName), specsOptimized);
    specsPath = `catalog/${segment}/${category}/${specsFileName}`;
  }

  const id = `${segment.toUpperCase()}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const product = CatalogService.create({
    id,
    segment: segment as any,
    category,
    name,
    description: (body.description as string) || null,
    price: parseFloat(price),
    installments: installments ? parseInt(installments, 10) : null,
    image_main_path: `catalog/${segment}/${category}/${fileName}`,
    image_specs_path: specsPath,
    created_by: user.id,
  });

  logAction(user.id, "create_product", "product", id, { name, segment, category });

  return c.json(product);
});

// Update product
catalog.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const updates = await c.req.json();

  // Validate updates
  if (updates.name !== undefined && typeof updates.name !== "string") {
    return c.json({ error: "Invalid name" }, 400);
  }
  if (updates.name !== undefined && updates.name.trim().length === 0) {
    return c.json({ error: "Name cannot be empty" }, 400);
  }
  if (updates.category !== undefined && typeof updates.category !== "string") {
    return c.json({ error: "Invalid category" }, 400);
  }
  if (updates.category !== undefined && updates.category.trim().length === 0) {
    return c.json({ error: "Category cannot be empty" }, 400);
  }
  if (updates.price !== undefined && (typeof updates.price !== "number" || updates.price <= 0)) {
    return c.json({ error: "Price must be a positive number" }, 400);
  }
  if (updates.installments !== undefined && updates.installments !== null) {
    if (typeof updates.installments !== "number" || updates.installments <= 0) {
      return c.json({ error: "Installments must be a positive number" }, 400);
    }
  }
  if (updates.stock_status !== undefined) {
    if (!['in_stock', 'low_stock', 'out_of_stock'].includes(updates.stock_status)) {
      return c.json({ error: "Invalid stock status" }, 400);
    }
  }
  if (updates.is_active !== undefined) {
    if (updates.is_active !== 0 && updates.is_active !== 1) {
      return c.json({ error: "is_active must be 0 or 1" }, 400);
    }
  }

  const product = CatalogService.update(id, updates);

  logAction(user.id, "update_product", "product", id, updates);

  return c.json({ success: true, product });
});

// Update product images
catalog.post("/:id/images", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const body = await c.req.parseBody();

  const existingProduct = CatalogService.getAll().find((p) => p.id === id);
  if (!existingProduct) {
    return c.json({ error: "Product not found" }, 404);
  }

  const mainFile = body.mainImage as File | undefined;
  const specsFile = body.specsImage as File | undefined;

  if (!mainFile && !specsFile) {
    return c.json({ error: "At least one image required" }, 400);
  }

  let mainPath: string | undefined;
  let specsPath: string | undefined;

  const dir = path.join(
    process.cwd(),
    "data",
    "uploads",
    "catalog",
    existingProduct.segment,
    existingProduct.category,
  );
  fs.mkdirSync(dir, { recursive: true });

  if (mainFile) {
    const buffer = await mainFile.arrayBuffer();
    const optimized = await sharp(Buffer.from(buffer))
      .resize(1024, 1024, { fit: "inside" })
      .jpeg({ quality: 85 })
      .toBuffer();

    const fileName = `${Date.now()}_${mainFile.name.replace(/\.[^.]+$/, "")}.jpg`;
    await Bun.write(path.join(dir, fileName), optimized);
    mainPath = `catalog/${existingProduct.segment}/${existingProduct.category}/${fileName}`;
  }

  if (specsFile) {
    const buffer = await specsFile.arrayBuffer();
    const optimized = await sharp(Buffer.from(buffer))
      .resize(1024, 1024, { fit: "inside" })
      .jpeg({ quality: 85 })
      .toBuffer();

    const fileName = `${Date.now()}_specs_${specsFile.name.replace(/\.[^.]+$/, "")}.jpg`;
    await Bun.write(path.join(dir, fileName), optimized);
    specsPath = `catalog/${existingProduct.segment}/${existingProduct.category}/${fileName}`;
  }

  const product = CatalogService.updateImages(id, mainPath, specsPath);

  logAction(user.id, "update_product_images", "product", id, {
    mainImage: !!mainFile,
    specsImage: !!specsFile,
  });

  return c.json({ success: true, product });
});

// Bulk update products
catalog.post("/bulk-update", async (c) => {
  const user = c.get("user");
  const { productIds, updates } = await c.req.json();

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return c.json({ error: "productIds must be a non-empty array" }, 400);
  }

  if (!updates || typeof updates !== "object") {
    return c.json({ error: "updates object required" }, 400);
  }

  // Validate bulk updates (only allow stock_status and is_active)
  const allowedFields = ["stock_status", "is_active"];
  const updateKeys = Object.keys(updates);
  const invalidKeys = updateKeys.filter((k) => !allowedFields.includes(k));

  if (invalidKeys.length > 0) {
    return c.json(
      { error: `Invalid fields for bulk update: ${invalidKeys.join(", ")}` },
      400,
    );
  }

  if (updates.stock_status !== undefined) {
    if (!['in_stock', 'low_stock', 'out_of_stock'].includes(updates.stock_status)) {
      return c.json({ error: "Invalid stock status" }, 400);
    }
  }

  if (updates.is_active !== undefined) {
    if (updates.is_active !== 0 && updates.is_active !== 1) {
      return c.json({ error: "is_active must be 0 or 1" }, 400);
    }
  }

  const count = CatalogService.bulkUpdate(productIds, updates);

  logAction(user.id, "bulk_update_products", "product", null, {
    count,
    productIds,
    updates,
  });

  return c.json({ success: true, count });
});

// Delete product
catalog.delete("/:id", (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  CatalogService.delete(id);

  logAction(user.id, "delete_product", "product", id);

  return c.json({ success: true });
});

// Extract product data from images (AI preview)
catalog.post("/extract-preview", async (c) => {
  const body = await c.req.parseBody();

  const mainImage = body.mainImage as File;
  if (!mainImage) {
    return c.json({ error: "Main image required" }, 400);
  }

  const specsImage = body.specsImage as File | undefined;

  try {
    // Convert images to buffers
    const mainBuffer = Buffer.from(await mainImage.arrayBuffer());
    const specsBuffer = specsImage
      ? Buffer.from(await specsImage.arrayBuffer())
      : undefined;

    // Extract data using vision AI
    const extractedData = await extractProductData(mainBuffer, specsBuffer);

    return c.json(extractedData);
  } catch (error) {
    console.error("Vision extraction error:", error);
    return c.json({ error: "Failed to extract data from images" }, 500);
  }
});

// Bulk import from CSV
catalog.post("/bulk", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();

  const csvFile = body.csv as File;
  if (!csvFile) {
    return c.json({ error: "CSV file required" }, 400);
  }

  const text = await csvFile.text();
  const result = await BulkImportService.processCsv(text, user.id);

  logAction(user.id, "bulk_import", "product", null, result);

  return c.json(result);
});

export default catalog;

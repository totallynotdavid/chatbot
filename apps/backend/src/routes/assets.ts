import { Hono } from "hono";
import { pathParam } from "../lib/http.ts";
import { AssetService } from "../domains/assets/index.ts";
import { servableContentType } from "../domains/assets/content-types.ts";
import { privateFileStorage } from "../adapters/storage/private-files.ts";
import { canAccessTenant } from "../platform/auth/scope.ts";
import { imageStorage } from "../adapters/storage/images.ts";
import { requireTenantScope } from "../middleware/auth.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("assets");

const assets = new Hono();

assets.use("/*", requireTenantScope);

/** Resolve an asset to its bytes (private) or its public URL (catalog images). */
assets.get("/:id", async (c) => {
  const scope = c.get("scope");
  const id = pathParam(c, "id");

  const asset = AssetService.getById(null, id);

  // An asset owned by another tenant is reported as missing, not forbidden, so
  // the endpoint cannot be used to probe which ids exist elsewhere.
  if (!asset || !canAccessTenant(scope, asset.tenant_id)) {
    return c.json({ error: "Asset not found" }, 404);
  }

  if (asset.visibility === "public") {
    // Catalog images are served from the static /media mount so Meta can fetch
    // them. Return the URL, not the bytes.
    const imageId = asset.storage_key
      .replace(/^images\//, "")
      .replace(/\.jpg$/, "");
    return c.json({
      id: asset.id,
      kind: asset.kind,
      visibility: asset.visibility,
      url: `/media${imageStorage.getUrl(imageId)}`,
    });
  }

  const file = privateFileStorage.read(asset.storage_key);

  if (!file) {
    logger.error(
      { assetId: asset.id, storageKey: asset.storage_key },
      "Asset row has no file behind it",
    );
    return c.json({ error: "Asset not found" }, 404);
  }

  // A private asset is a file to save, never a page to render. It is served as
  // an attachment with a content type from the allowlist for its kind, not the
  // one the uploader declared. Otherwise an .html or .svg uploaded as a
  // "contract" executes on this origin when its /api/assets/:id URL is opened.
  return new Response(file.stream(), {
    headers: {
      "Content-Type": servableContentType(asset),
      "Content-Disposition": `attachment; filename="${downloadName(asset)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

/**
 * A filename for the download. The original one is not kept, so the asset id
 * names the file and the stored key supplies the extension. The final replace
 * leaves only `[A-Za-z0-9._+-]`, so nothing here can break out of the quoted
 * header value.
 */
function downloadName(asset: { id: string; storage_key: string }): string {
  const base = asset.storage_key.split("/").pop() ?? "";
  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
  return `${asset.id}${extension}`.replace(/[^A-Za-z0-9._+-]/g, "_");
}

/** List the caller's tenant's assets, optionally filtered by kind. */
assets.get("/", (c) => {
  const scope = c.get("scope");

  if (!scope.tenantId) {
    return c.json({ error: "Select a tenant to list assets" }, 400);
  }

  const kind = c.req.query("kind") as
    | "catalog_image"
    | "contract"
    | "recording"
    | undefined;

  return c.json({ assets: AssetService.listForTenant(scope.tenantId, kind) });
});

export default assets;

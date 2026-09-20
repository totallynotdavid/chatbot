/**
 * `assets.content_type` is the uploading browser's `File.type`, which the
 * client controls. GET /api/assets/:id therefore serves private assets as
 * attachments, with a content type from the allowlist for their kind. An
 * uploaded .html or .svg never runs as a page on the backend's origin.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";

import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { db } from "../src/db/index.ts";
import { requireAuth } from "../src/middleware/auth.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import assetRoutes from "../src/routes/assets.ts";
import { AssetService } from "../src/domains/assets/index.ts";
import { uploadContract } from "../src/domains/conversations/media.ts";
import { privateFileStorage } from "../src/adapters/storage/private-files.ts";
import { PRIVATE_DIR } from "../src/lib/storage-paths.ts";

const CUSTOMER = "51987651111";

function buildApp() {
  const app = new Hono();
  app.use("/api/*", requireAuth);
  app.route("/api/assets", assetRoutes);
  return app;
}

describe("serving a private asset", () => {
  let app: ReturnType<typeof buildApp>;
  let tenant: TenantFixture;
  let cookie: string;

  beforeEach(async () => {
    applySchema();
    app = buildApp();
    tenant = createTenantFixture("private-assets");

    const { userId } = createMember(tenant, "admin");
    const token = generateSessionToken();
    createSession(token, userId, tenant.tenantId);
    cookie = `session=${token}`;
  });

  afterEach(() => {
    rmSync(path.join(PRIVATE_DIR, tenant.tenantId), {
      recursive: true,
      force: true,
    });
    db.prepare("DELETE FROM session").run();
    dropTenantFixture(tenant);
  });

  /**
   * An asset row with bytes behind it, written straight to the store so the
   * content type can be anything, including one no upload path would record.
   */
  async function storedAsset(options: {
    kind: "contract" | "recording";
    contentType: string | null;
    filename: string;
    body: string;
  }) {
    const id = crypto.randomUUID();
    const storageKey = `${tenant.tenantId}/contracts/${id}-${options.filename}`;
    await privateFileStorage.write(storageKey, Buffer.from(options.body));

    return AssetService.create({
      id,
      tenantId: tenant.tenantId,
      kind: options.kind,
      visibility: "private",
      storageKey,
      contentType: options.contentType,
    });
  }

  function fetchAsset(id: string) {
    return app.request(`/api/assets/${id}`, { headers: { Cookie: cookie } });
  }

  it("never renders an uploaded page in the browser", async () => {
    const asset = await storedAsset({
      kind: "contract",
      contentType: "text/html",
      filename: "contrato.html",
      body: "<script>fetch('/api/conversations')</script>",
    });

    const response = await fetchAsset(asset.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${asset.id}.html"`,
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");

    // The bytes are the ones that were uploaded. Only their labelling differs.
    expect(await response.text()).toContain("<script>");
  });

  it("does not serve an SVG as an image either", async () => {
    const asset = await storedAsset({
      kind: "contract",
      contentType: "image/svg+xml",
      filename: "contrato.svg",
      body: '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
    });

    const response = await fetchAsset(asset.id);

    expect(response.headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("Content-Disposition")).toStartWith(
      "attachment;",
    );
  });

  it("keeps the real content type of a genuine contract", async () => {
    const asset = await storedAsset({
      kind: "contract",
      contentType: "application/pdf",
      filename: "contrato.pdf",
      body: "%PDF-1.4",
    });

    const response = await fetchAsset(asset.id);

    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    // Still an attachment: a private asset is a file to save, not a page.
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${asset.id}.pdf"`,
    );
  });

  it("keeps the real content type of a recording", async () => {
    const asset = await storedAsset({
      kind: "recording",
      contentType: "audio/mpeg",
      filename: "llamada.mp3",
      body: "ID3",
    });

    const response = await fetchAsset(asset.id);

    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
  });

  it("does not let an audio type through on a contract", async () => {
    // The allowlist is per kind, not one shared set.
    const asset = await storedAsset({
      kind: "contract",
      contentType: "audio/mpeg",
      filename: "contrato.mp3",
      body: "ID3",
    });

    expect((await fetchAsset(asset.id)).headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
  });

  it("cannot be talked into a header injection by the stored key", async () => {
    const asset = await storedAsset({
      kind: "contract",
      contentType: "application/pdf",
      filename: 'a";x=".pdf',
      body: "%PDF-1.4",
    });

    const disposition = (await fetchAsset(asset.id)).headers.get(
      "Content-Disposition",
    );

    expect(disposition).toBe(`attachment; filename="${asset.id}.pdf"`);
  });
});

describe("recording the content type of an upload", () => {
  let tenant: TenantFixture;
  let uploaderId: string;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("upload-types");
    uploaderId = createMember(tenant, "sales_agent").userId;
    insertConversation(tenant.ref(CUSTOMER));
  });

  afterEach(() => {
    rmSync(path.join(PRIVATE_DIR, tenant.tenantId), {
      recursive: true,
      force: true,
    });
    dropTenantFixture(tenant);
  });

  function upload(contract: File, audio: File) {
    return uploadContract({
      ref: tenant.ref(CUSTOMER),
      userId: uploaderId,
      contractFile: contract,
      audioFile: audio,
      userDisplayName: "Test User",
    });
  }

  it("stores the declared type when the kind is served as it", async () => {
    const result = await upload(
      new File(["%PDF-1.4"], "contrato.pdf", { type: "application/pdf" }),
      new File(["ID3"], "llamada.mp3", { type: "audio/mpeg" }),
    );

    expect(
      AssetService.getById(tenant.tenantId, result.contractAssetId)
        ?.content_type,
    ).toBe("application/pdf");
    expect(
      AssetService.getById(tenant.tenantId, result.audioAssetId)?.content_type,
    ).toBe("audio/mpeg");
  });

  it("keeps the file but not a type it will never be served as", async () => {
    const result = await upload(
      new File(["<script>alert(1)</script>"], "contrato.html", {
        type: "text/html",
      }),
      new File(["ID3"], "llamada.mp3", { type: "audio/mpeg" }),
    );

    const contract = AssetService.getById(
      tenant.tenantId,
      result.contractAssetId,
    );

    expect(contract?.content_type).toBeNull();
    // The upload itself is not refused: it is somebody's file, and the header
    // the browser wrote is not grounds for losing it.
    expect(contract?.byte_size).toBe("<script>alert(1)</script>".length);
    expect(
      await privateFileStorage.read(contract!.storage_key)?.text(),
    ).toContain("<script>");
  });

  it("ignores the parameters a browser appends to the type", async () => {
    const result = await upload(
      new File(["%PDF-1.4"], "contrato.pdf", { type: "application/pdf" }),
      new File(["webm"], "llamada.webm", { type: "audio/webm;codecs=opus" }),
    );

    expect(
      AssetService.getById(tenant.tenantId, result.audioAssetId)?.content_type,
    ).toBe("audio/webm");
  });
});

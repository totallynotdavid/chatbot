/**
 * Signed contracts and call recordings. An asset id names its own file, so a
 * later upload for the same conversation cannot change the bytes an earlier id
 * serves. The audit trail, the notification event and handed-out links name it.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";

import {
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import { uploadContract } from "../src/domains/conversations/media.ts";
import { AssetService } from "../src/domains/assets/index.ts";
import { privateFileStorage } from "../src/adapters/storage/private-files.ts";
import { PRIVATE_DIR } from "../src/lib/storage-paths.ts";
import { db } from "../src/db/index.ts";

const CUSTOMER = "51987650000";

describe("uploading a contract", () => {
  let tenant: TenantFixture;
  let uploaderId: string;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("uploads");
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

  function upload(contract: string, audio: string) {
    return uploadContract({
      ref: tenant.ref(CUSTOMER),
      userId: uploaderId,
      contractFile: new File([contract], "contrato.pdf", {
        type: "application/pdf",
      }),
      audioFile: new File([audio], "llamada.mp3", { type: "audio/mpeg" }),
      userDisplayName: "Test User",
    });
  }

  function assetOf(assetId: string) {
    const asset = AssetService.getById(tenant.tenantId, assetId);
    if (!asset) throw new Error(`No asset ${assetId}`);
    return asset;
  }

  /** The bytes /api/assets/:id would serve for that asset. */
  async function bytesOf(assetId: string): Promise<string | null> {
    const file = privateFileStorage.read(assetOf(assetId).storage_key);
    return file ? await file.text() : null;
  }

  it("keeps serving each asset id the bytes it was minted for", async () => {
    const first = await upload("first contract", "first recording");
    const second = await upload("corrected contract", "second recording");

    expect(second.contractAssetId).not.toBe(first.contractAssetId);
    expect(second.audioAssetId).not.toBe(first.audioAssetId);

    expect(await bytesOf(first.contractAssetId)).toBe("first contract");
    expect(await bytesOf(first.audioAssetId)).toBe("first recording");
    expect(await bytesOf(second.contractAssetId)).toBe("corrected contract");
    expect(await bytesOf(second.audioAssetId)).toBe("second recording");
  });

  it("gives every asset its own storage key", async () => {
    const first = await upload("first contract", "first recording");
    const second = await upload("corrected contract", "second recording");

    const keys = AssetService.listForTenant(tenant.tenantId).map(
      (a) => a.storage_key,
    );

    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);

    for (const id of [
      first.contractAssetId,
      first.audioAssetId,
      second.contractAssetId,
      second.audioAssetId,
    ]) {
      const asset = assetOf(id);
      expect(asset.storage_key).toContain(id);
      expect(asset.storage_key.startsWith(`${tenant.tenantId}/`)).toBe(true);
    }
  });

  it("points the conversation at the latest upload", async () => {
    await upload("first contract", "first recording");
    const second = await upload("corrected contract", "second recording");

    const conversation = db
      .prepare(
        `SELECT recording_contract_asset_id, recording_audio_asset_id
         FROM conversations
         WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
      )
      .get(tenant.tenantId, tenant.channelAccountId, CUSTOMER) as {
      recording_contract_asset_id: string;
      recording_audio_asset_id: string;
    };

    expect(conversation.recording_contract_asset_id).toBe(
      second.contractAssetId,
    );
    expect(conversation.recording_audio_asset_id).toBe(second.audioAssetId);
  });

  it("records the byte size of each upload separately", async () => {
    const first = await upload("short", "first recording");
    const second = await upload("a much longer contract", "second recording");

    const sizeOf = (id: string) => assetOf(id).byte_size;

    expect(sizeOf(first.contractAssetId)).toBe("short".length);
    expect(sizeOf(second.contractAssetId)).toBe(
      "a much longer contract".length,
    );
  });
});

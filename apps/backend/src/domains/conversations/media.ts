import { db } from "../../db/index.ts";
import { logAction } from "../../platform/audit/logger.ts";
import { eventBus, createEvent } from "../../shared/events/index.ts";
import { AssetService } from "../assets/index.ts";
import { storableContentType } from "../assets/content-types.ts";
import {
  privateFileStorage,
  privateStorageKey,
} from "../../adapters/storage/private-files.ts";
import { createLogger } from "../../lib/logger.ts";
import type { Asset, ConversationRef } from "@vendeya/types";

const logger = createLogger("conversation-media");

type UploadContractInput = {
  ref: ConversationRef;
  userId: string;
  contractFile: File;
  audioFile: File;
  clientName?: string;
  userDisplayName: string;
};

/** Used when the uploaded file has no extension to take one from. */
const FALLBACK_EXTENSION = { contract: "pdf", recording: "mp3" } as const;

/**
 * Contracts and call recordings are private assets. They are written under the
 * tenant's private storage prefix, never the statically served uploads
 * directory, and are reachable only through /api/assets/:id.
 */
async function storeUpload(
  ref: ConversationRef,
  userId: string,
  kind: keyof typeof FALLBACK_EXTENSION,
  file: File,
): Promise<Asset> {
  const extension = file.name.split(".").pop() || FALLBACK_EXTENSION[kind];
  // The asset id names the file, so every upload has its own storage key and an
  // id always serves the bytes it was created for. Re-uploading a corrected
  // contract adds an asset instead of overwriting what an audit trail, an event
  // or an old link points at.
  const assetId = crypto.randomUUID();

  const storageKey = privateStorageKey(
    ref.tenantId,
    "contracts",
    ref.channelAccountId,
    ref.phoneNumber,
    `${assetId}.${extension}`,
  );

  const bytes = Buffer.from(await file.arrayBuffer());
  await privateFileStorage.write(storageKey, bytes);

  // `file.type` is whatever the uploading browser declared, so it is recorded
  // only when this kind of asset is served as that type. The file is kept
  // either way, because it is somebody's signed contract. An unrecognised claim
  // is dropped instead of stored for /api/assets/:id to echo back.
  const contentType = storableContentType(kind, file.type);

  if (file.type && !contentType) {
    logger.warn(
      { assetId, kind, declaredContentType: file.type, tenantId: ref.tenantId },
      "Upload declared a content type this asset kind is not served as; storing none",
    );
  }

  return AssetService.create({
    id: assetId,
    tenantId: ref.tenantId,
    kind,
    visibility: "private",
    storageKey,
    contentType,
    byteSize: bytes.byteLength,
    createdBy: userId,
  });
}

export async function uploadContract(input: UploadContractInput): Promise<{
  success: boolean;
  contractAssetId: string;
  audioAssetId: string;
}> {
  const { ref, userId, contractFile, audioFile, clientName } = input;

  const contractAsset = await storeUpload(
    ref,
    userId,
    "contract",
    contractFile,
  );
  const audioAsset = await storeUpload(ref, userId, "recording", audioFile);

  const now = Date.now();
  db.prepare(
    `UPDATE conversations
     SET recording_contract_asset_id = ?, recording_audio_asset_id = ?, recording_uploaded_at = ?
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
  ).run(
    contractAsset.id,
    audioAsset.id,
    now,
    ref.tenantId,
    ref.channelAccountId,
    ref.phoneNumber,
  );

  logAction(
    { userId, tenantId: ref.tenantId },
    "upload_contract",
    "conversation",
    ref.phoneNumber,
    {
      contractFile: contractFile.name,
      audioFile: audioFile.name,
      contractAssetId: contractAsset.id,
      audioAssetId: audioAsset.id,
    },
  );

  eventBus.emit(
    createEvent(
      "contract_uploaded",
      {
        phoneNumber: ref.phoneNumber,
        clientName: clientName || "Cliente",
        contractPath: `/api/assets/${contractAsset.id}`,
      },
      { tenantId: ref.tenantId, channelAccountId: ref.channelAccountId },
    ),
  );

  return {
    success: true,
    contractAssetId: contractAsset.id,
    audioAssetId: audioAsset.id,
  };
}

/**
 * Asset registry.
 *
 * Two visibilities, and the difference is deliberate:
 *
 *  - `public` covers catalog images only. When we send an image message, Meta
 *    fetches the `link` we hand it from its own servers with no session and no
 *    header we control, so those bytes have to be reachable unauthenticated.
 *    They are still owned by a tenant (the row records it, and catalog reads are
 *    tenant-scoped), and the storage key is a random 16-hex id, so the URL is
 *    unguessable rather than merely unauthenticated. That is the whole of the
 *    exception.
 *
 *  - `private` covers signed contracts and call recordings. Those are never
 *    served statically; they are only reachable through /api/assets/:id, which
 *    resolves the asset's tenant and checks the caller's scope first, and hands
 *    the bytes back as an attachment with a content type off the allowlist for
 *    the kind - never the one the uploading browser declared. See
 *    ./content-types.ts for why that matters.
 */

import { db } from "../../db/index.ts";
import { getAll, getOne, tenantPredicate } from "../../db/query.ts";
import type { Asset, AssetKind, AssetVisibility } from "@totem/types";

export const AssetService = {
  create: (data: {
    tenantId: string;
    kind: AssetKind;
    visibility: AssetVisibility;
    storageKey: string;
    contentType?: string | null;
    byteSize?: number | null;
    createdBy?: string | null;
    id?: string;
  }): Asset => {
    const id = data.id ?? crypto.randomUUID();

    db.prepare(
      `INSERT INTO assets (id, tenant_id, kind, visibility, storage_key, content_type, byte_size, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      data.tenantId,
      data.kind,
      data.visibility,
      data.storageKey,
      data.contentType ?? null,
      data.byteSize ?? null,
      data.createdBy ?? null,
    );

    return AssetService.getById(data.tenantId, id)!;
  },

  /**
   * `tenantId` null skips the tenant predicate and is only for platform
   * operators; route handlers pass the caller's scope.
   */
  getById: (tenantId: string | null, id: string): Asset | null =>
    getOne<Asset>(
      `SELECT * FROM assets WHERE id = ? AND ${tenantPredicate(tenantId)}`,
      tenantId ? [id, tenantId] : [id],
    ) ?? null,

  getByStorageKey: (
    tenantId: string | null,
    storageKey: string,
  ): Asset | null =>
    getOne<Asset>(
      `SELECT * FROM assets WHERE storage_key = ? AND ${tenantPredicate(tenantId)}`,
      tenantId ? [storageKey, tenantId] : [storageKey],
    ) ?? null,

  listForTenant: (tenantId: string, kind?: AssetKind): Asset[] =>
    getAll<Asset>(
      `SELECT * FROM assets WHERE tenant_id = ? ${kind ? "AND kind = ?" : ""}
       ORDER BY created_at DESC`,
      kind ? [tenantId, kind] : [tenantId],
    ),

  deleteById: (tenantId: string, id: string): void => {
    db.prepare("DELETE FROM assets WHERE id = ? AND tenant_id = ?").run(
      id,
      tenantId,
    );
  },

  deleteByStorageKey: (tenantId: string, storageKey: string): void => {
    db.prepare(
      "DELETE FROM assets WHERE storage_key = ? AND tenant_id = ?",
    ).run(storageKey, tenantId);
  },
};

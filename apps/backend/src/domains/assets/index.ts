/**
 * Asset registry. `public` is for catalog images only. Meta fetches them with
 * no session, so the storage key is a random id that keeps the URL unguessable.
 * `private` assets are reachable only through /api/assets/:id, which checks the
 * caller's scope first.
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
   * A null `tenantId` reads across open tenants. Pass it only when the caller
   * checks tenant access itself, as GET /api/assets/:id does.
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

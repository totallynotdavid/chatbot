import { db } from "../../db/index.ts";
import { getAll, tenantOrPlatformPredicate } from "../../db/query.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import type { AuditLog } from "@totem/types";

/**
 * Who did it and inside which tenant. `tenantId` is null only for actions taken
 * outside any tenant - platform operators editing global settings, say.
 */
export type AuditActor = {
  userId: string;
  tenantId: string | null;
};

export function logAction(
  actor: AuditActor,
  action: string,
  resourceType: string,
  resourceId: string | null = null,
  metadata: Record<string, any> = {},
): void {
  const id = crypto.randomUUID();
  const metadataJson = JSON.stringify(metadata);

  db.prepare(
    `INSERT INTO audit_log (id, tenant_id, user_id, action, resource_type, resource_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    actor.tenantId,
    actor.userId,
    action,
    resourceType,
    resourceId,
    metadataJson,
  );
}

/**
 * `tenantId` null returns the whole trail and is only reachable by platform
 * operators; a tenant-scoped caller sees their own tenant's entries.
 */
export function getAuditTrail(
  tenantId: string | null,
  userId?: string,
  limit: number = 100,
): AuditLog[] {
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  conditions.push(tenantOrPlatformPredicate(tenantId));
  if (tenantId) params.push(tenantId);
  if (userId) {
    conditions.push("user_id = ?");
    params.push(userId);
  }

  params.push(limit);

  return getAll<AuditLog>(
    `SELECT * FROM audit_log
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
  );
}

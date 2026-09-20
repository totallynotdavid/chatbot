import { db } from "../../db/index.ts";
import { getAll, tenantOrPlatformPredicate } from "../../db/query.ts";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { AuditLog } from "@totem/types";

/**
 * Who did it and inside which tenant. `tenantId` is null only for actions taken
 * outside any tenant, such as a platform operator editing global settings.
 */
export type AuditActor = {
  userId: string;
  tenantId: string | null;
};

/**
 * Who ran a command in a terminal. The environment can change `name` but not
 * `uid`, so a row records both.
 */
export type CliOperator = {
  name: string;
  uid: number;
};

/** Writes audit rows through one connection. */
export function auditOn(database: Database) {
  function insert(
    actor: string,
    userId: string | null,
    tenantId: string | null,
    action: string,
    resourceType: string,
    resourceId: string | null,
    metadata: Record<string, any>,
  ): void {
    database
      .prepare(
        `INSERT INTO audit_log (id, tenant_id, user_id, actor, action, resource_type, resource_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        tenantId,
        userId,
        actor,
        action,
        resourceType,
        resourceId,
        JSON.stringify(metadata),
      );
  }

  return {
    logAction: (
      actor: AuditActor,
      action: string,
      resourceType: string,
      resourceId: string | null = null,
      metadata: Record<string, any> = {},
    ): void =>
      insert(
        `user:${actor.userId}`,
        actor.userId,
        actor.tenantId,
        action,
        resourceType,
        resourceId,
        metadata,
      ),

    logCliAction: (
      operator: CliOperator,
      tenantId: string | null,
      action: string,
      resourceType: string,
      resourceId: string | null,
      metadata: Record<string, any> = {},
    ): void =>
      insert(
        `cli:${operator.name}`,
        null,
        tenantId,
        action,
        resourceType,
        resourceId,
        { ...metadata, uid: operator.uid },
      ),
  };
}

export function logAction(
  actor: AuditActor,
  action: string,
  resourceType: string,
  resourceId: string | null = null,
  metadata: Record<string, any> = {},
): void {
  auditOn(db).logAction(actor, action, resourceType, resourceId, metadata);
}

/**
 * `tenantId` null returns the entries of every open tenant and the platform's
 * own rows. The audit route passes null only for an unpinned platform operator.
 * A tenant-scoped caller sees their own tenant's entries.
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

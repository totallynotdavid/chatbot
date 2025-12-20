import { db } from "../db/index.ts";
import type { AuditLog } from "@totem/types";

export function logAction(
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string | null = null,
    metadata: Record<string, any> = {},
): void {
    const id = crypto.randomUUID();
    const metadataJson = JSON.stringify(metadata);

    db.prepare(
        `INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, metadata) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, action, resourceType, resourceId, metadataJson);
}

export function getAuditTrail(
    userId?: string,
    limit: number = 100,
): AuditLog[] {
    if (userId) {
        return db
            .prepare(
                `SELECT * FROM audit_log 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`,
            )
            .all(userId, limit) as AuditLog[];
    }

    return db
        .prepare(
            `SELECT * FROM audit_log 
       ORDER BY created_at DESC 
       LIMIT ?`,
        )
        .all(limit) as AuditLog[];
}

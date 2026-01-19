import { db } from "../../db/index.ts";

export type SystemLogSource = "llm" | "audit";
export type SystemLogStatus = "success" | "error" | "info";

export interface SystemLogEntry {
  id: string;
  timestamp: string;
  source: SystemLogSource;
  event: string;
  status: SystemLogStatus;
  actor: string;
  summary: string;
  metadata?: any;
  original_data: any;
}

export class SystemLogService {
  static getRecentLogs(limit: number = 100): SystemLogEntry[] {
    // Get LLM Calls
    const llmCalls = db
      .prepare(
        `SELECT 
           id, created_at, operation, status, phone_number, latency_ms, 
           prompt, response, error_message, context_metadata
         FROM llm_calls 
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as any[];

    // Get Audit Logs
    const auditLogs = db
      .prepare(
        `SELECT 
           a.id, a.created_at, a.action, a.resource_type, a.resource_id, a.metadata,
           u.username as actor_name, a.user_id
         FROM audit_log a
         LEFT JOIN users u ON a.user_id = u.id
         ORDER BY a.created_at DESC LIMIT ?`,
      )
      .all(limit) as any[];

    const normalized: SystemLogEntry[] = [
      ...llmCalls.map((c) => ({
        id: c.id,
        timestamp: c.created_at,
        source: "llm" as const,
        event: c.operation,
        status: (c.status as SystemLogStatus) || "info",
        actor: c.phone_number,
        summary:
          c.status === "error" ? c.error_message : `${c.latency_ms}ms latency`,
        metadata: c.context_metadata ? JSON.parse(c.context_metadata) : {},
        original_data: c,
      })),
      ...auditLogs.map((a) => ({
        id: a.id,
        timestamp: new Date(a.created_at).toISOString(),
        source: "audit" as const,
        event: a.action,
        status: "info" as const,
        actor: a.actor_name || "Unknown User",
        summary: `${a.resource_type} ${a.resource_id || ""}`.trim(),
        metadata:
          a.metadata && a.metadata !== "{}" ? JSON.parse(a.metadata) : {},
        original_data: a,
      })),
    ];

    return normalized
      .sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        return dateB - dateA;
      })
      .slice(0, limit);
  }
}

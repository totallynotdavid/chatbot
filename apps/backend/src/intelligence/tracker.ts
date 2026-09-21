import { db } from "../db/index.ts";
import { getAll, tenantPredicate } from "../db/query.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import type { ConversationRef } from "@vendeya/types";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("llm-tracker");

export type LLMCallData = {
  ref: ConversationRef;
  operation: string;
  model: string;
  prompt: string;
  userMessage: string;
  response?: string;
  status: "success" | "error";
  errorType?: string;
  errorMessage?: string;
  latencyMs: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
  tokensTotal?: number;
  conversationPhase?: string;
  contextMetadata?: Record<string, any>;
};

export function trackLLMCall(data: LLMCallData): void {
  _trackLLMCallAsync(data).catch((err) => {
    logger.error(
      { err, operation: data.operation },
      "Failed to track LLM call",
    );
  });
}

async function _trackLLMCallAsync(data: LLMCallData): Promise<void> {
  const id = crypto.randomUUID();
  const contextJson = data.contextMetadata
    ? JSON.stringify(data.contextMetadata)
    : null;

  db.prepare(
    `INSERT INTO llm_calls (
      id, tenant_id, channel_account_id, phone_number, operation, model,
      prompt, user_message, response,
      status, error_type, error_message,
      latency_ms, tokens_prompt, tokens_completion, tokens_total,
      conversation_phase, context_metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.ref.tenantId,
    data.ref.channelAccountId,
    data.ref.phoneNumber,
    data.operation,
    data.model,
    data.prompt,
    data.userMessage,
    data.response || null,
    data.status,
    data.errorType || null,
    data.errorMessage || null,
    data.latencyMs,
    data.tokensPrompt || null,
    data.tokensCompletion || null,
    data.tokensTotal || null,
    data.conversationPhase || null,
    contextJson,
  );
}

/** `tenantId` null spans tenants and is only reachable by platform operators. */
export function getRecentLLMCalls(tenantId: string | null, limit: number = 50) {
  const params: SQLQueryBindings[] = tenantId ? [tenantId, limit] : [limit];

  return getAll(
    `SELECT * FROM llm_calls
     WHERE ${tenantPredicate(tenantId)}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
  );
}

/**
 * Get error rate and performance stats by operation
 */
export function getLLMErrorStats(
  tenantId: string | null,
  hoursBack: number = 24,
) {
  const conditions = ["created_at > datetime('now', '-' || ? || ' hours')"];
  const params: SQLQueryBindings[] = [hoursBack];

  conditions.push(tenantPredicate(tenantId));
  if (tenantId) params.push(tenantId);

  return getAll(
    `SELECT
       operation,
       COUNT(*) as total_calls,
       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
       ROUND(AVG(latency_ms), 2) as avg_latency_ms
     FROM llm_calls
     WHERE ${conditions.join(" AND ")}
     GROUP BY operation
     ORDER BY total_calls DESC`,
    params,
  );
}

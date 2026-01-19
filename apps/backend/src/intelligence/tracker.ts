import { db } from "../db/index.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("llm-tracker");

export type LLMCallData = {
  phoneNumber: string;
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
      id, phone_number, operation, model,
      prompt, user_message, response,
      status, error_type, error_message,
      latency_ms, tokens_prompt, tokens_completion, tokens_total,
      conversation_phase, context_metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.phoneNumber,
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

export function getRecentLLMCalls(limit: number = 50) {
  return db
    .prepare(
      `SELECT * FROM llm_calls 
       ORDER BY created_at DESC 
       LIMIT ?`,
    )
    .all(limit);
}

/**
 * Get error rate and performance stats by operation
 */
export function getLLMErrorStats(hoursBack: number = 24) {
  return db
    .prepare(
      `SELECT 
         operation,
         COUNT(*) as total_calls,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
         ROUND(AVG(latency_ms), 2) as avg_latency_ms
       FROM llm_calls
       WHERE created_at > datetime('now', '-' || ? || ' hours')
       GROUP BY operation
       ORDER BY total_calls DESC`,
    )
    .all(hoursBack);
}

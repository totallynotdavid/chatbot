import { db } from "../db/index.ts";
import { getAll } from "../db/query.ts";

type InboxMessage = {
  id: number;
  phone_number: string;
  message_text: string;
  message_id: string;
  whatsapp_timestamp: number;
  status: "pending" | "processing" | "processed" | "failed";
  aggregate_id: string | null;
  attempts: number;
  last_error: string | null;
  created_at: number;
  processed_at: number | null;
};

type AggregatedGroup = {
  phone_number: string;
  ids: string;
  aggregated_text: string;
  oldest_timestamp: number;
  latest_message_id: string;
};

export function storeIncomingMessage(
  phoneNumber: string,
  text: string,
  messageId: string,
  whatsappTimestamp: number,
): void {
  const now = Date.now();

  db.prepare(
    `INSERT INTO message_inbox (phone_number, message_text, message_id, whatsapp_timestamp, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(phoneNumber, text, messageId, whatsappTimestamp, now);
}

export function getReadyForAggregation(
  quietWindowMs: number,
): AggregatedGroup[] {
  const cutoffTime = Date.now() - quietWindowMs;

  const groups = getAll<AggregatedGroup>(
    `SELECT 
       phone_number,
       GROUP_CONCAT(id) as ids,
       GROUP_CONCAT(message_text, ' ') as aggregated_text,
       MIN(whatsapp_timestamp) as oldest_timestamp,
       MAX(message_id) as latest_message_id
     FROM message_inbox
     WHERE status = 'pending'
       AND created_at < ?
     GROUP BY phone_number`,
    [cutoffTime],
  );

  return groups;
}

/**
 * Mark messages as processing (prevents double-processing)
 */
export function markAsProcessing(ids: string): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");

  db.prepare(
    `UPDATE message_inbox SET status = 'processing' WHERE id IN (${placeholders})`,
  ).run(...idList);
}

export function markAsProcessed(ids: string): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");

  db.prepare(
    `UPDATE message_inbox 
     SET status = 'processed', processed_at = ? 
     WHERE id IN (${placeholders})`,
  ).run(Date.now(), ...idList);
}

export function markAsFailed(ids: string, error: string): void {
  const idList = ids.split(",").map((id) => id.trim());
  const placeholders = idList.map(() => "?").join(",");

  db.prepare(
    `UPDATE message_inbox 
     SET status = 'failed', attempts = attempts + 1, last_error = ? 
     WHERE id IN (${placeholders})`,
  ).run(error, ...idList);
}

export function countPending(): number {
  const result = db
    .prepare(
      `SELECT COUNT(*) as count FROM message_inbox WHERE status = 'pending'`,
    )
    .get() as { count: number };
  return result.count;
}

export function countFailed(): number {
  const result = db
    .prepare(
      `SELECT COUNT(*) as count FROM message_inbox WHERE status = 'failed'`,
    )
    .get() as { count: number };
  return result.count;
}

export function getFailedMessages(limit = 100): InboxMessage[] {
  return getAll<InboxMessage>(
    `SELECT * FROM message_inbox WHERE status = 'failed' ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
}

export function retryFailed(maxAttempts = 3): number {
  const result = db
    .prepare(
      `UPDATE message_inbox SET status = 'pending', last_error = NULL 
       WHERE status = 'failed' AND attempts < ?`,
    )
    .run(maxAttempts);

  return result.changes;
}

export function cleanupOldMessages(daysToKeep = 7): number {
  const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

  const result = db
    .prepare(
      `DELETE FROM message_inbox WHERE status = 'processed' AND processed_at < ?`,
    )
    .run(cutoffTime);

  return result.changes;
}

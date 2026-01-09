import { db } from "../db/index.ts";
import { getAll } from "../db/query.ts";

type HeldMessage = {
  id: number;
  phone_number: string;
  message_text: string;
  message_id: string;
  whatsapp_timestamp: number;
  created_at: string;
};

/**
 * Store a message received during maintenance mode
 */
export function holdMessage(
  phoneNumber: string,
  text: string,
  messageId: string,
  whatsappTimestamp: number,
): void {
  db.prepare(
    `INSERT INTO held_messages (phone_number, message_text, message_id, whatsapp_timestamp)
     VALUES (?, ?, ?, ?)`,
  ).run(phoneNumber, text, messageId, whatsappTimestamp);

  console.log(
    `[HeldMessages] Stored message from ${phoneNumber} during maintenance`,
  );
}

/**
 * Get all held messages, oldest first
 */
export function getHeldMessages(): HeldMessage[] {
  return getAll<HeldMessage>(
    `SELECT * FROM held_messages ORDER BY created_at ASC`,
  );
}

/**
 * Delete held messages after processing
 */
export function clearHeldMessages(ids: number[]): void {
  if (ids.length === 0) return;

  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM held_messages WHERE id IN (${placeholders})`).run(
    ...ids,
  );

  console.log(`[HeldMessages] Cleared ${ids.length} processed messages`);
}

/**
 * Count held messages (for monitoring)
 */
export function countHeldMessages(): number {
  const result = db
    .prepare(`SELECT COUNT(*) as count FROM held_messages`)
    .get() as { count: number };
  return result.count;
}

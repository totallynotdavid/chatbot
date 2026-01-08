import { db } from "../../db/index.ts";
import { randomUUID } from "node:crypto";

export type QueuedMessage = {
  id: string;
  phone_number: string;
  message_text: string;
  whatsapp_message_id: string | null;
  whatsapp_timestamp: number;
  status: "pending" | "processing" | "processed" | "failed";
  group_id: string | null;
  processed_at: number | null;
  error_message: string | null;
  retry_count: number;
  created_at: number;
};

const DEBOUNCE_WINDOW_MS = 3000;

export function enqueueMessage(
  phoneNumber: string,
  messageText: string,
  whatsappTimestamp: number,
  whatsappMessageId?: string,
): string {
  const messageId = randomUUID();
  const now = Date.now();

  // Check if there's a recent pending message from this user
  const recentMessage = db
    .prepare(
      `SELECT id, group_id 
       FROM message_queue 
       WHERE phone_number = ? 
         AND status = 'pending' 
         AND created_at > ?
       ORDER BY created_at DESC 
       LIMIT 1`,
    )
    .get(phoneNumber, now - DEBOUNCE_WINDOW_MS) as
    | { id: string; group_id: string | null }
    | undefined;

  let groupId: string;

  if (recentMessage) {
    // Add to existing group
    groupId = recentMessage.group_id || recentMessage.id;
  } else {
    // Start new group
    groupId = messageId;
  }

  db.prepare(
    `INSERT INTO message_queue 
     (id, phone_number, message_text, whatsapp_message_id, whatsapp_timestamp, group_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    messageId,
    phoneNumber,
    messageText,
    whatsappMessageId || null,
    whatsappTimestamp,
    groupId,
    now,
  );

  return messageId;
}

export function dequeueNextGroup(): QueuedMessage[] | null {
  const now = Date.now();

  // Find oldest pending group that's past debounce window
  const oldestPending = db
    .prepare(
      `SELECT group_id 
       FROM message_queue 
       WHERE status = 'pending' 
         AND created_at < ?
       ORDER BY created_at ASC 
       LIMIT 1`,
    )
    .get(now - DEBOUNCE_WINDOW_MS) as { group_id: string } | undefined;

  if (!oldestPending) {
    return null;
  }

  const groupId = oldestPending.group_id;

  // Mark all messages in group as processing
  db.prepare(
    `UPDATE message_queue 
     SET status = 'processing' 
     WHERE group_id = ? AND status = 'pending'`,
  ).run(groupId);

  // Return all messages in group
  const messages = db
    .prepare(
      `SELECT * FROM message_queue 
       WHERE group_id = ? 
       ORDER BY created_at ASC`,
    )
    .all(groupId) as QueuedMessage[];

  return messages;
}

export function markGroupProcessed(groupId: string): void {
  const now = Date.now();
  db.prepare(
    `UPDATE message_queue 
     SET status = 'processed', processed_at = ? 
     WHERE group_id = ?`,
  ).run(now, groupId);
}

export function markGroupFailed(groupId: string, errorMessage: string): void {
  db.prepare(
    `UPDATE message_queue 
     SET status = 'failed', 
         error_message = ?, 
         retry_count = retry_count + 1 
     WHERE group_id = ?`,
  ).run(errorMessage, groupId);
}

export function getPendingCount(): number {
  const result = db
    .prepare(
      `SELECT COUNT(*) as count FROM message_queue WHERE status = 'pending'`,
    )
    .get() as { count: number };
  return result.count;
}

export function cleanupOldMessages(): number {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const result = db
    .prepare(
      `DELETE FROM message_queue 
       WHERE status = 'processed' 
         AND processed_at < ?`,
    )
    .run(sevenDaysAgo);
  return result.changes;
}

export function detectBacklog(messages: QueuedMessage[]): {
  isBacklog: boolean;
  oldestMessageAge: number;
} {
  if (messages.length === 0) {
    return { isBacklog: false, oldestMessageAge: 0 };
  }

  const now = Date.now();
  const oldestTimestamp = Math.min(
    ...messages.map((m) => m.whatsapp_timestamp * 1000),
  );
  const oldestMessageAge = now - oldestTimestamp;
  const isBacklog = oldestMessageAge > 10 * 60 * 1000;

  return { isBacklog, oldestMessageAge };
}

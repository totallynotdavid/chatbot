import { db } from "../../db/index.ts";
import type {
  ConversationMessage,
  MessageDirection,
  MessageType,
} from "./types.ts";

export const MessageStore = {
  log(
    phoneNumber: string,
    direction: MessageDirection,
    type: MessageType,
    content: string,
    status: string = "sent",
    whatsappMessageId?: string,
    productId?: string,
  ): void {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO messages (id, phone_number, direction, type, content, status, whatsapp_message_id, product_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      phoneNumber,
      direction,
      type,
      content,
      status,
      whatsappMessageId ?? null,
      productId ?? null,
    );
  },

  findProductByMessageId(whatsappMessageId: string): string | null {
    const result = db
      .prepare(`SELECT product_id FROM messages WHERE whatsapp_message_id = ?`)
      .get(whatsappMessageId) as { product_id: string } | undefined;
    return result?.product_id ?? null;
  },

  getMessageById(whatsappMessageId: string): ConversationMessage | null {
    const result = db
      .prepare(`SELECT * FROM messages WHERE whatsapp_message_id = ?`)
      .get(whatsappMessageId) as ConversationMessage | undefined;
    return result ?? null;
  },

  getHistory(phoneNumber: string, limit: number = 50): ConversationMessage[] {
    return db
      .prepare(
        `SELECT * FROM messages 
         WHERE phone_number = ? 
         ORDER BY created_at DESC, ROWID DESC 
         LIMIT ?`,
      )
      .all(phoneNumber, limit) as ConversationMessage[];
  },

  clear(phoneNumber: string): void {
    db.prepare(`DELETE FROM messages WHERE phone_number = ? `).run(phoneNumber);
  },
};

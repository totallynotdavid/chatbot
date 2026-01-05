import { db } from "../../db/index.ts";
import type { Message, MessageDirection, MessageType } from "./types.ts";

export const MessageStore = {
  log(
    phoneNumber: string,
    direction: MessageDirection,
    type: MessageType,
    content: string,
    status: string = "sent",
  ): void {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO messages (id, phone_number, direction, type, content, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, phoneNumber, direction, type, content, status);
  },

  getHistory(phoneNumber: string, limit: number = 50): Message[] {
    return db
      .prepare(
        `SELECT * FROM messages 
         WHERE phone_number = ? 
         ORDER BY created_at DESC, ROWID DESC 
         LIMIT ?`,
      )
      .all(phoneNumber, limit) as Message[];
  },

  clear(phoneNumber: string): void {
    db.prepare(`DELETE FROM messages WHERE phone_number = ?`).run(phoneNumber);
  },
};

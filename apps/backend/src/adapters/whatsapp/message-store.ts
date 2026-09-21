import { db } from "../../db/index.ts";
import { getAll, getOne } from "../../db/query.ts";
import type { ConversationRef } from "@vendeya/types";
import type {
  ConversationMessage,
  MessageDirection,
  StoredMessageType,
} from "./types.ts";

/**
 * Message history is keyed by the full conversation identity, so the same
 * contact number writing to two businesses keeps two separate threads.
 */
export const MessageStore = {
  log(
    ref: ConversationRef,
    direction: MessageDirection,
    type: StoredMessageType,
    content: string,
    status: string = "sent",
    whatsappMessageId?: string,
    productId?: string,
  ): string {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO messages (id, tenant_id, channel_account_id, phone_number, direction, type, content, status, whatsapp_message_id, product_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      ref.tenantId,
      ref.channelAccountId,
      ref.phoneNumber,
      direction,
      type,
      content,
      status,
      whatsappMessageId ?? null,
      productId ?? null,
    );

    // The outbox row keeps this id, so a retry moves this row rather than
    // writing a second one for the same reply.
    return id;
  },

  findProductByMessageId(
    ref: ConversationRef,
    whatsappMessageId: string,
  ): string | null {
    const result = getOne<{ product_id: string | null }>(
      `SELECT product_id FROM messages
       WHERE whatsapp_message_id = ? AND tenant_id = ? AND channel_account_id = ?`,
      [whatsappMessageId, ref.tenantId, ref.channelAccountId],
    );
    return result?.product_id ?? null;
  },

  getMessageById(
    ref: ConversationRef,
    whatsappMessageId: string,
  ): ConversationMessage | null {
    return (
      getOne<ConversationMessage>(
        `SELECT * FROM messages
         WHERE whatsapp_message_id = ? AND tenant_id = ? AND channel_account_id = ?`,
        [whatsappMessageId, ref.tenantId, ref.channelAccountId],
      ) ?? null
    );
  },

  getHistory(ref: ConversationRef, limit: number = 50): ConversationMessage[] {
    return getAll<ConversationMessage>(
      `SELECT * FROM messages
       WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
       ORDER BY created_at DESC, ROWID DESC
       LIMIT ?`,
      [ref.tenantId, ref.channelAccountId, ref.phoneNumber, limit],
    );
  },

  clear(ref: ConversationRef): void {
    db.prepare(
      `DELETE FROM messages
       WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
    ).run(ref.tenantId, ref.channelAccountId, ref.phoneNumber);
  },
};

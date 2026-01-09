import {
  getHeldMessages,
  clearHeldMessages,
  countHeldMessages,
} from "./held-messages.ts";
import { handleMessage } from "./handler.ts";

/**
 * Process all held messages from maintenance mode
 * @returns Number of messages processed
 */
export async function processHeldMessages(): Promise<number> {
  const heldMessages = getHeldMessages();

  if (heldMessages.length === 0) {
    return 0;
  }

  console.log(`[HeldMessages] Processing ${heldMessages.length} held messages`);

  const processedIds: number[] = [];

  for (const msg of heldMessages) {
    try {
      await handleMessage({
        phoneNumber: msg.phone_number,
        content: msg.message_text,
        timestamp: msg.whatsapp_timestamp,
        messageId: msg.message_id,
      });

      processedIds.push(msg.id);
    } catch (error) {
      console.error(
        `[HeldMessages] Failed to process message ${msg.id} from ${msg.phone_number}:`,
        error,
      );
      // Continue with next message, don't mark this one as processed
    }
  }

  // Clear processed messages
  if (processedIds.length > 0) {
    clearHeldMessages(processedIds);
  }

  return processedIds.length;
}

/**
 * Get count of pending held messages
 */
export function getPendingCount(): number {
  return countHeldMessages();
}

/**
 * Conversation Module
 *
 * New architecture entry point for handling WhatsApp conversations.
 */

export { handleMessage, type IncomingMessage } from "./handler.ts";
export { messageAggregator } from "./aggregator.ts";
export {
  getOrCreateConversation,
  updateConversation,
  escalateConversation,
  resetSession,
  isSessionTimedOut,
} from "./store.ts";
export { holdMessage, countHeldMessages } from "./held-messages.ts";
export {
  processHeldMessages,
  getPendingCount as getPendingHeldCount,
} from "./process-held.ts";

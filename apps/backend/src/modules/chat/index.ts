/**
 * Chat Module - Message Processing Pipeline
 *
 * This module handles all message processing in an async, non-blocking way:
 *
 * Flow:
 * 1. Webhook receives message → enqueues to DB (queue.ts)
 * 2. Background processor polls queue (processor.ts)
 * 3. Pipeline processes message through state machine (pipeline.ts)
 * 4. Commands executed (dispatcher.ts)
 * 5. Message marked as processed
 *
 * Benefits:
 * - Webhook responds in < 100ms (no LLM blocking)
 * - Messages persist in DB (no loss on restart)
 * - Automatic debouncing via time windows
 * - Clean separation of concerns
 */

export { enqueueMessage, getPendingCount } from "./queue.ts";
export {
  startProcessor,
  stopProcessor,
  getProcessorStatus,
} from "./processor.ts";
export { processMessagePipeline } from "./pipeline.ts";
export { executeCommand } from "./dispatcher.ts";
export {
  getOrCreateConversation,
  updateConversationState,
  buildStateContext,
  resetSession,
  escalateConversation,
} from "./context.ts";

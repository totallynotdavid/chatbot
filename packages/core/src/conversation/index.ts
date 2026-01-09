/**
 * Conversation Module - Pure State Machine
 *
 * Exports the transition function and related types.
 */

export { transition } from "./transition.ts";
export type {
  ConversationPhase,
  ConversationMetadata,
  EnrichmentRequest,
  EnrichmentResult,
  TransitionResult,
  TransitionInput,
  Command,
} from "./types.ts";

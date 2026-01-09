/**
 * Greeting phase transition
 */

import type { ConversationMetadata, TransitionResult } from "../types.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import * as T from "../../templates/standard.ts";

export function transitionGreeting(
  metadata: ConversationMetadata,
): TransitionResult {
  // Check if returning user had previous interest
  if (metadata.lastCategory) {
    const variants = T.GREETING_RETURNING(metadata.lastCategory);
    const { message } = selectVariant(variants, "GREETING_RETURNING", {});

    return {
      type: "update",
      nextPhase: { phase: "confirming_client" },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "session_start",
          metadata: { returning: true },
        },
        { type: "SEND_MESSAGE", text: message },
      ],
    };
  }

  const { message } = selectVariant(T.GREETING, "GREETING", {});

  return {
    type: "update",
    nextPhase: { phase: "confirming_client" },
    commands: [
      {
        type: "TRACK_EVENT",
        event: "session_start",
        metadata: { returning: false },
      },
      { type: "SEND_MESSAGE", text: message },
    ],
  };
}

import type { ConversationMetadata, TransitionResult } from "../types.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import * as T from "../../templates/standard.ts";

export function transitionGreeting(
  metadata: ConversationMetadata,
): TransitionResult {
  // Check if returning user had previous interest
  if (metadata.lastCategory) {
    const variants = T.GREETING_RETURNING(metadata.lastCategory);
    const { message: response } = selectVariant(variants, "GREETING_RETURNING", {});
    const messages = Array.isArray(response) ? response : [response];

    return {
      type: "update",
      nextPhase: { phase: "confirming_client" },
      commands: [
        {
          type: "TRACK_EVENT",
          event: "session_start",
          metadata: { returning: true },
        },
        ...messages.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
      ],
    };
  }

  const { message: response } = selectVariant(T.GREETING, "GREETING", {});
  const messages = Array.isArray(response) ? response : [response];

  return {
    type: "update",
    nextPhase: { phase: "confirming_client" },
    commands: [
      {
        type: "TRACK_EVENT",
        event: "session_start",
        metadata: { returning: false },
      },
      ...messages.map((text) => ({ type: "SEND_MESSAGE" as const, text })),
    ],
  };
}

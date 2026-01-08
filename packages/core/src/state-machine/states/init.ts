import type { StateOutput, Command } from "../types.ts";
import * as T from "../../templates/standard.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";

export function handleInit(context: any): StateOutput {
  const commands: Command[] = [
    { type: "TRACK_EVENT", eventType: "session_start", metadata: {} },
  ];

  let variantUpdate = {};

  // Check if returning user had previous interest
  if (context.lastInterestCategory) {
    const greetingVariants = T.GREETING_RETURNING(context.lastInterestCategory);
    const { message, updatedContext } = selectVariant(
      greetingVariants,
      "GREETING_RETURNING",
      context,
    );
    commands.push({
      type: "SEND_MESSAGE",
      content: message,
    });
    variantUpdate = updatedContext;
  } else {
    const { message, updatedContext } = selectVariant(
      T.GREETING,
      "GREETING",
      context,
    );
    commands.push({
      type: "SEND_MESSAGE",
      content: message,
    });
    variantUpdate = updatedContext;
  }

  return {
    nextState: "CONFIRM_CLIENT",
    commands,
    updatedContext: {
      sessionStartedAt: new Date().toISOString(),
      ...variantUpdate,
    },
  };
}

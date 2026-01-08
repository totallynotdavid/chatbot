import type { StateOutput } from "../types.ts";

export function handleClosing(_context: any): StateOutput {
  // Customer has confirmed purchase - terminal state, team has been notified
  return {
    nextState: "CLOSING",
    commands: [],
    updatedContext: {},
  };
}

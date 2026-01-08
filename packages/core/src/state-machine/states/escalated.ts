import type { StateOutput } from "../types.ts";

export function handleEscalated(_context: any): StateOutput {
  return {
    nextState: "ESCALATED",
    commands: [],
    updatedContext: {},
  };
}

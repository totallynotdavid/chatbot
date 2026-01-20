import type { Result } from "../../../shared/result/index.ts";
import { Ok, Err } from "../../../shared/result/index.ts";
import { db } from "../../../db/index.ts";

export type WaitingConversation = {
  phone_number: string;
  context_data: string;
};

export function getWaitingConversations(): Result<
  WaitingConversation[],
  Error
> {
  try {
    const rows = db
      .prepare(
        `SELECT phone_number, context_data 
         FROM conversations 
         WHERE current_state = 'waiting_for_recovery'`,
      )
      .all() as WaitingConversation[];

    return Ok(rows);
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}

export function countWaitingForRecovery(): number {
  const result = db
    .prepare(
      `SELECT COUNT(*) as count 
       FROM conversations 
       WHERE current_state = 'waiting_for_recovery'`,
    )
    .get() as { count: number };

  return result.count;
}

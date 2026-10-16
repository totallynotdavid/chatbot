import type { AnswerContext, RecoveryContext } from "./types";

export interface IntelligenceProvider {
  // Classification operations
  isQuestion(message: string): Promise<boolean>;
  shouldEscalate(message: string): Promise<boolean>;

  // Generation operations
  answerQuestion(message: string, context: AnswerContext): Promise<string>;
  recoverUnclearResponse(
    message: string,
    context: RecoveryContext,
  ): Promise<string>;
}

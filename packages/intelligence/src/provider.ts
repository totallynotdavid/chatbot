import type { AnswerContext, RecoveryContext, ProductData } from "./types";

export interface IntelligenceProvider {
  // Classification operations
  isQuestion(message: string): Promise<boolean>;
  shouldEscalate(message: string): Promise<boolean>;

  // Generation operations
  answerQuestion(message: string, context: AnswerContext): Promise<string>;
  suggestAlternative(
    requestedCategory: string,
    availableCategories: string[],
  ): Promise<string>;
  recoverUnclearResponse(
    message: string,
    context: RecoveryContext,
  ): Promise<string>;

  // Vision operations (uses different model/client)
  extractProductData(
    mainImageBuffer: Buffer,
    specsImageBuffer?: Buffer,
  ): Promise<ProductData>;
}

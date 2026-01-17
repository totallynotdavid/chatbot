import type { Bundle } from "@totem/types";
import type {
  AnswerContext,
  RecoveryContext,
  IntentResult,
  ProductData,
} from "./types";

export interface IntelligenceProvider {
  // Classification operations
  isQuestion(message: string): Promise<boolean>;
  shouldEscalate(message: string): Promise<boolean>;
  isProductRequest(message: string): Promise<boolean>;

  // Extraction operations
  extractBundleIntent(
    message: string,
    bundles: Bundle[],
  ): Promise<IntentResult>;

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
  handleBacklogResponse(message: string, delayMinutes: number): Promise<string>;

  // Vision operations (uses different model/client)
  extractProductData(
    mainImageBuffer: Buffer,
    specsImageBuffer?: Buffer,
  ): Promise<ProductData>;
}

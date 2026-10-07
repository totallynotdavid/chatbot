import type { IntelligenceProvider } from "../provider";
import * as Classification from "./classification";
import * as Answer from "./models/answer";
import * as Suggest from "./models/suggest";
import * as Recover from "./models/recover";
import * as Vision from "./models/vision";

let cachedProvider: IntelligenceProvider | null = null;

export function getProvider(): IntelligenceProvider {
  if (!cachedProvider) {
    cachedProvider = {
      isQuestion: (message) => Classification.isQuestion(message),

      shouldEscalate: (message) => Classification.shouldEscalate(message),

      answerQuestion: (message, context) =>
        Answer.answerQuestion(message, context),

      suggestAlternative: (requested, available) =>
        Suggest.suggestAlternative(requested, available),

      recoverUnclearResponse: (message, context) =>
        Recover.recoverUnclearResponse(message, context),

      extractProductData: (mainBuffer, specsBuffer) =>
        Vision.extractProductData(mainBuffer, specsBuffer),
    };
  }
  return cachedProvider;
}

export function resetProvider(): void {
  cachedProvider = null;
}

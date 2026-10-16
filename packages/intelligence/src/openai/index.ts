import type { IntelligenceProvider } from "../provider";
import * as Classification from "./classification";
import * as Answer from "./models/answer";
import * as Recover from "./models/recover";

let cachedProvider: IntelligenceProvider | null = null;

export function getProvider(): IntelligenceProvider {
  if (!cachedProvider) {
    cachedProvider = {
      isQuestion: (message) => Classification.isQuestion(message),

      shouldEscalate: (message) => Classification.shouldEscalate(message),

      answerQuestion: (message, context) =>
        Answer.answerQuestion(message, context),

      recoverUnclearResponse: (message, context) =>
        Recover.recoverUnclearResponse(message, context),
    };
  }
  return cachedProvider;
}

export function resetProvider(): void {
  cachedProvider = null;
}

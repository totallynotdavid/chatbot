import type { IntelligenceProvider } from "../provider";
import { createTextClient, createVisionClient } from "./shared";
import * as Classification from "./classification";
import * as Extraction from "./extraction";
import * as Generation from "./generation";
import * as Vision from "./vision";

export function createOpenAIProvider(): IntelligenceProvider {
  const textClient = createTextClient();
  const visionClient = createVisionClient();

  return {
    isQuestion: (message) => Classification.isQuestion(textClient, message),

    shouldEscalate: (message) =>
      Classification.shouldEscalate(textClient, message),

    isProductRequest: (message) =>
      Classification.isProductRequest(textClient, message),

    extractBundleIntent: (message, bundles) =>
      Extraction.extractBundleIntent(textClient, message, bundles),

    answerQuestion: (message, context) =>
      Generation.answerQuestion(textClient, message, context),

    suggestAlternative: (requested, available) =>
      Generation.suggestAlternative(textClient, requested, available),

    recoverUnclearResponse: (message, context) =>
      Generation.recoverUnclearResponse(textClient, message, context),

    handleBacklogResponse: (message, delayMinutes) =>
      Generation.handleBacklogResponse(textClient, message, delayMinutes),

    extractProductData: (mainBuffer, specsBuffer) =>
      Vision.extractProductData(visionClient, mainBuffer, specsBuffer),
  };
}

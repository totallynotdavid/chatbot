import { getProvider, MODEL_CONFIG } from "@totem/intelligence";
import { trackLLMCall } from "./tracker";
import { classifyLLMError } from "./llm-errors";
import type {
  AnswerContext,
  RecoveryContext,
  IntentResult,
} from "@totem/intelligence";
import type { ConversationRef } from "@totem/types";
import { BundleService } from "../domains/catalog/bundles";

function withObservability<T>(
  ref: ConversationRef,
  operation: string,
  model: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  const startTime = Date.now();

  return fn()
    .then((result) => {
      trackLLMCall({
        ref,
        operation,
        model,
        prompt: "",
        userMessage: "",
        status: "success",
        latencyMs: Date.now() - startTime,
      });
      return result;
    })
    .catch((e) => {
      const error = classifyLLMError(e);
      trackLLMCall({
        ref,
        operation,
        model,
        prompt: "",
        userMessage: "",
        status: "error",
        errorType: error.type,
        errorMessage: error.message,
        latencyMs: Date.now() - startTime,
      });
      return fallback;
    });
}

export const LLM = {
  isQuestion: (message: string, ref: ConversationRef) =>
    withObservability(
      ref,
      "isQuestion",
      MODEL_CONFIG.classification.model,
      () => getProvider().isQuestion(message),
      false,
    ),

  shouldEscalate: (message: string, ref: ConversationRef) =>
    withObservability(
      ref,
      "shouldEscalate",
      MODEL_CONFIG.classification.model,
      () => getProvider().shouldEscalate(message),
      false,
    ),

  isProductRequest: (message: string, ref: ConversationRef) =>
    withObservability(
      ref,
      "isProductRequest",
      MODEL_CONFIG.classification.model,
      () => getProvider().isProductRequest(message),
      false,
    ),

  extractBundleIntent: (
    message: string,
    ref: ConversationRef,
    segment: "fnb" | "gaso",
    creditLine: number,
  ): Promise<IntentResult> => {
    const affordableBundles = BundleService.getAvailable(ref.tenantId, {
      segment,
      maxPrice: creditLine,
    });

    return withObservability(
      ref,
      "extractBundleIntent",
      MODEL_CONFIG.extraction.model,
      () => getProvider().extractBundleIntent(message, affordableBundles),
      { bundle: null, confidence: 0 },
    );
  },

  answerQuestion: (
    message: string,
    context: AnswerContext,
    ref: ConversationRef,
  ) =>
    withObservability(
      ref,
      "answerQuestion",
      MODEL_CONFIG.generation.model,
      () => getProvider().answerQuestion(message, context),
      "Déjame revisar eso y te respondo.",
    ),

  suggestAlternative: (
    requestedCategory: string,
    availableCategories: string[],
    ref: ConversationRef,
  ) =>
    withObservability(
      ref,
      "suggestAlternative",
      MODEL_CONFIG.generation.model,
      () =>
        getProvider().suggestAlternative(
          requestedCategory,
          availableCategories,
        ),
      `No tenemos ${requestedCategory} disponible ahorita. ¿Te interesa algo más?`,
    ),

  recoverUnclearResponse: (
    message: string,
    context: RecoveryContext,
    ref: ConversationRef,
  ) =>
    withObservability(
      ref,
      "recoverUnclearResponse",
      MODEL_CONFIG.generation.model,
      () => getProvider().recoverUnclearResponse(message, context),
      "Disculpa, no entendí bien. ¿Podrías decirme de nuevo?",
    ),

  handleBacklogResponse: (
    message: string,
    delayMinutes: number,
    ref: ConversationRef,
  ) =>
    withObservability(
      ref,
      "handleBacklogResponse",
      MODEL_CONFIG.generation.model,
      () => getProvider().handleBacklogResponse(message, delayMinutes),
      "Disculpa la demora, recién vi tu mensaje.",
    ),
};

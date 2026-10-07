import { getProvider, MODEL_CONFIG } from "@vendeya/intelligence";
import { trackLLMCall } from "./tracker";
import { classifyLLMError } from "./llm-errors";
import type { AnswerContext, RecoveryContext } from "@vendeya/intelligence";
import type { ConversationRef } from "@vendeya/types";

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
};

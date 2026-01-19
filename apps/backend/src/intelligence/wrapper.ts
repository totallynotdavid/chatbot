import type { IntelligenceProvider, IntentResult } from "@totem/intelligence";
import { BundleService } from "../domains/catalog/bundles";
import { classifyLLMError } from "./llm-errors";
import { trackLLMCall } from "./tracker";
import {
  buildIsQuestionPrompt,
  buildShouldEscalatePrompt,
  buildIsProductRequestPrompt,
  buildExtractBundleIntentPrompt,
  buildAnswerQuestionPrompt,
  buildSuggestAlternativePrompt,
  buildRecoverUnclearPrompt,
  buildHandleBacklogPrompt,
} from "@totem/core";

const MODEL = "gpt-5-nano-2025-08-07";

export async function safeIsQuestion(
  provider: IntelligenceProvider,
  message: string,
  phoneNumber: string,
): Promise<boolean> {
  const startTime = Date.now();
  const prompt = buildIsQuestionPrompt();

  try {
    const result = await provider.isQuestion(message);
    const latencyMs = Date.now() - startTime;

    trackLLMCall({
      phoneNumber,
      operation: "isQuestion",
      model: MODEL,
      prompt,
      userMessage: message,
      response: String(result),
      status: "success",
      latencyMs,
    });

    return result;
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    const error = classifyLLMError(e);

    trackLLMCall({
      phoneNumber,
      operation: "isQuestion",
      model: MODEL,
      prompt,
      userMessage: message,
      status: "error",
      errorType: error.type,
      errorMessage: error.message,
      latencyMs,
    });

    return false;
  }
}

export async function safeShouldEscalate(
  provider: IntelligenceProvider,
  message: string,
  phoneNumber: string,
): Promise<boolean> {
  const startTime = Date.now();
  const prompt = buildShouldEscalatePrompt();

  try {
    const result = await provider.shouldEscalate(message);
    const latencyMs = Date.now() - startTime;

    trackLLMCall({
      phoneNumber,
      operation: "shouldEscalate",
      model: MODEL,
      prompt,
      userMessage: message,
      response: String(result),
      status: "success",
      latencyMs,
    });

    return result;
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    const error = classifyLLMError(e);

    trackLLMCall({
      phoneNumber,
      operation: "shouldEscalate",
      model: MODEL,
      prompt,
      userMessage: message,
      status: "error",
      errorType: error.type,
      errorMessage: error.message,
      latencyMs,
    });

    return false;
  }
}

export async function safeIsProductRequest(
  provider: IntelligenceProvider,
  message: string,
  phoneNumber: string,
): Promise<boolean> {
  const startTime = Date.now();
  const prompt = buildIsProductRequestPrompt();

  try {
    const result = await provider.isProductRequest(message);
    const latencyMs = Date.now() - startTime;

    trackLLMCall({
      phoneNumber,
      operation: "isProductRequest",
      model: MODEL,
      prompt,
      userMessage: message,
      response: String(result),
      status: "success",
      latencyMs,
    });

    return result;
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    const error = classifyLLMError(e);

    trackLLMCall({
      phoneNumber,
      operation: "isProductRequest",
      model: MODEL,
      prompt,
      userMessage: message,
      status: "error",
      errorType: error.type,
      errorMessage: error.message,
      latencyMs,
    });

    return false;
  }
}

export async function safeExtractBundleIntent(
  provider: IntelligenceProvider,
  message: string,
  phoneNumber: string,
  segment: "fnb" | "gaso",
  creditLine: number,
): Promise<IntentResult> {
  const startTime = Date.now();
  const affordableBundles = BundleService.getAvailable({
    segment,
    maxPrice: creditLine,
  });
  const prompt = buildExtractBundleIntentPrompt(affordableBundles);

  try {
    const result = await provider.extractBundleIntent(
      message,
      affordableBundles,
    );
    const latencyMs = Date.now() - startTime;

    trackLLMCall({
      phoneNumber,
      operation: "extractBundleIntent",
      model: MODEL,
      prompt,
      userMessage: message,
      response: JSON.stringify(result),
      status: "success",
      latencyMs,
      contextMetadata: {
        segment,
        creditLine,
        bundleCount: affordableBundles.length,
      },
    });

    return result;
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    const error = classifyLLMError(e);

    trackLLMCall({
      phoneNumber,
      operation: "extractBundleIntent",
      model: MODEL,
      prompt,
      userMessage: message,
      status: "error",
      errorType: error.type,
      errorMessage: error.message,
      latencyMs,
      contextMetadata: {
        segment,
        creditLine,
        bundleCount: affordableBundles.length,
      },
    });

    return { bundle: null, confidence: 0 };
  }
}

export async function safeAnswerQuestion(
  provider: IntelligenceProvider,
  message: string,
  context: {
    segment?: string;
    credit?: number;
    phase: string;
    availableCategories: string[];
  },
  phoneNumber: string,
): Promise<string> {
  const startTime = Date.now();
  const answerContext = {
    segment: context.segment,
    creditLine: context.credit,
    phase: context.phase,
    availableCategories: context.availableCategories,
  };
  const prompt = buildAnswerQuestionPrompt(answerContext);

  try {
    const result = await provider.answerQuestion(message, answerContext);
    const latencyMs = Date.now() - startTime;

    trackLLMCall({
      phoneNumber,
      operation: "answerQuestion",
      model: MODEL,
      prompt,
      userMessage: message,
      response: result,
      status: "success",
      latencyMs,
      conversationPhase: context.phase,
      contextMetadata: context,
    });

    return result;
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    const error = classifyLLMError(e);

    trackLLMCall({
      phoneNumber,
      operation: "answerQuestion",
      model: MODEL,
      prompt,
      userMessage: message,
      status: "error",
      errorType: error.type,
      errorMessage: error.message,
      latencyMs,
      conversationPhase: context.phase,
      contextMetadata: context,
    });

    return "Déjame revisar eso y te respondo.";
  }
}

export async function safeSuggestAlternative(
  provider: IntelligenceProvider,
  requestedCategory: string,
  availableCategories: string[],
  phoneNumber: string,
): Promise<string> {
  const startTime = Date.now();
  const prompt = buildSuggestAlternativePrompt(
    requestedCategory,
    availableCategories,
  );

  try {
    const result = await provider.suggestAlternative(
      requestedCategory,
      availableCategories,
    );
    const latencyMs = Date.now() - startTime;

    trackLLMCall({
      phoneNumber,
      operation: "suggestAlternative",
      model: MODEL,
      prompt,
      userMessage: requestedCategory,
      response: result,
      status: "success",
      latencyMs,
      contextMetadata: {
        requestedCategory,
        availableCategories,
      },
    });

    return result;
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    const error = classifyLLMError(e);

    trackLLMCall({
      phoneNumber,
      operation: "suggestAlternative",
      model: MODEL,
      prompt,
      userMessage: requestedCategory,
      status: "error",
      errorType: error.type,
      errorMessage: error.message,
      latencyMs,
      contextMetadata: {
        requestedCategory,
        availableCategories,
      },
    });

    return `No tenemos ${requestedCategory} disponible ahorita. ¿Te interesa algo más?`;
  }
}

export async function safeRecoverUnclearResponse(
  provider: IntelligenceProvider,
  message: string,
  context: {
    phase: string;
    lastQuestion?: string;
    expectedOptions?: string[];
    availableCategories?: string[];
  },
  phoneNumber: string,
): Promise<string> {
  const startTime = Date.now();
  const prompt = buildRecoverUnclearPrompt(context);

  try {
    const result = await provider.recoverUnclearResponse(message, context);
    const latencyMs = Date.now() - startTime;

    trackLLMCall({
      phoneNumber,
      operation: "recoverUnclearResponse",
      model: MODEL,
      prompt,
      userMessage: message,
      response: result,
      status: "success",
      latencyMs,
      conversationPhase: context.phase,
      contextMetadata: {
        expectedOptions: context.expectedOptions,
        availableCategories: context.availableCategories,
      },
    });

    return result;
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    const error = classifyLLMError(e);

    trackLLMCall({
      phoneNumber,
      operation: "recoverUnclearResponse",
      model: MODEL,
      prompt,
      userMessage: message,
      status: "error",
      errorType: error.type,
      errorMessage: error.message,
      latencyMs,
      conversationPhase: context.phase,
      contextMetadata: {
        expectedOptions: context.expectedOptions,
        availableCategories: context.availableCategories,
      },
    });

    return "Disculpa, no entendí bien. ¿Podrías decirme de nuevo?";
  }
}

export async function safeHandleBacklogResponse(
  provider: IntelligenceProvider,
  message: string,
  delayMinutes: number,
  phoneNumber: string,
): Promise<string> {
  const startTime = Date.now();
  const prompt = buildHandleBacklogPrompt(message, delayMinutes);

  try {
    const result = await provider.handleBacklogResponse(message, delayMinutes);
    const latencyMs = Date.now() - startTime;

    trackLLMCall({
      phoneNumber,
      operation: "handleBacklogResponse",
      model: MODEL,
      prompt,
      userMessage: message,
      response: result,
      status: "success",
      latencyMs,
      conversationPhase: "greeting",
      contextMetadata: {
        delayMinutes,
      },
    });

    return result;
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    const error = classifyLLMError(e);

    trackLLMCall({
      phoneNumber,
      operation: "handleBacklogResponse",
      model: MODEL,
      prompt,
      userMessage: message,
      status: "error",
      errorType: error.type,
      errorMessage: error.message,
      latencyMs,
      conversationPhase: "greeting",
      contextMetadata: {
        delayMinutes,
      },
    });

    return "Disculpa la demora, recién vi tu mensaje.";
  }
}

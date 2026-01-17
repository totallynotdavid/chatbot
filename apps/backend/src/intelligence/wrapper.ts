import type { IntelligenceProvider, IntentResult } from "@totem/intelligence";
import { BundleService } from "../domains/catalog/bundles";
import { classifyLLMError } from "../adapters/llm/types";
import { logLLMError } from "../adapters/llm/error-logger";

export async function safeIsQuestion(
  provider: IntelligenceProvider,
  message: string,
  phoneNumber: string,
): Promise<boolean> {
  try {
    return await provider.isQuestion(message);
  } catch (e) {
    logLLMError(phoneNumber, "isQuestion", classifyLLMError(e), "unknown");
    return false;
  }
}

export async function safeShouldEscalate(
  provider: IntelligenceProvider,
  message: string,
  phoneNumber: string,
): Promise<boolean> {
  try {
    return await provider.shouldEscalate(message);
  } catch (e) {
    logLLMError(phoneNumber, "shouldEscalate", classifyLLMError(e), "unknown");
    return false;
  }
}

export async function safeIsProductRequest(
  provider: IntelligenceProvider,
  message: string,
  phoneNumber: string,
): Promise<boolean> {
  try {
    return await provider.isProductRequest(message);
  } catch (e) {
    logLLMError(
      phoneNumber,
      "isProductRequest",
      classifyLLMError(e),
      "unknown",
    );
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
  try {
    const affordableBundles = BundleService.getAvailable({
      segment,
      maxPrice: creditLine,
    });

    return await provider.extractBundleIntent(message, affordableBundles);
  } catch (e) {
    logLLMError(
      phoneNumber,
      "extractBundleIntent",
      classifyLLMError(e),
      "unknown",
      {
        bundleCount: BundleService.getAvailable({
          segment,
          maxPrice: creditLine,
        }).length,
      },
    );
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
  try {
    return await provider.answerQuestion(message, {
      segment: context.segment,
      creditLine: context.credit,
      phase: context.phase,
      availableCategories: context.availableCategories,
    });
  } catch (e) {
    logLLMError(
      phoneNumber,
      "answerQuestion",
      classifyLLMError(e),
      context.phase,
    );
    return "Déjame revisar eso y te respondo.";
  }
}

export async function safeSuggestAlternative(
  provider: IntelligenceProvider,
  requestedCategory: string,
  availableCategories: string[],
  phoneNumber: string,
): Promise<string> {
  try {
    return await provider.suggestAlternative(
      requestedCategory,
      availableCategories,
    );
  } catch (e) {
    logLLMError(
      phoneNumber,
      "suggestAlternative",
      classifyLLMError(e),
      undefined,
      {
        requestedCategory,
        availableCategories,
      },
    );
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
  },
  phoneNumber: string,
): Promise<string> {
  try {
    return await provider.recoverUnclearResponse(message, context);
  } catch (e) {
    logLLMError(
      phoneNumber,
      "recoverUnclearResponse",
      classifyLLMError(e),
      context.phase,
    );
    return "Disculpa, no entendí bien. ¿Podrías decirme de nuevo?";
  }
}

export async function safeHandleBacklogResponse(
  provider: IntelligenceProvider,
  message: string,
  delayMinutes: number,
  phoneNumber: string,
): Promise<string> {
  try {
    return await provider.handleBacklogResponse(message, delayMinutes);
  } catch (e) {
    logLLMError(
      phoneNumber,
      "handleBacklogResponse",
      classifyLLMError(e),
      "greeting",
      {
        delayMinutes,
      },
    );
    return "Disculpa la demora, recién vi tu mensaje.";
  }
}

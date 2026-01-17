import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type { Bundle } from "@totem/types";
import type { IntelligenceProvider } from "@totem/intelligence";
import { checkEligibilityWithFallback } from "../domains/eligibility/orchestrator.ts";
import {
  safeIsQuestion,
  safeShouldEscalate,
  safeIsProductRequest,
  safeExtractBundleIntent,
  safeAnswerQuestion,
  safeHandleBacklogResponse,
  safeRecoverUnclearResponse,
} from "../intelligence/wrapper.ts";

import { BundleService } from "../domains/catalog/index.ts";
import { getCategoryDisplayNames } from "../adapters/catalog/display.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("enrichment");

export async function executeEnrichment(
  request: EnrichmentRequest,
  phoneNumber: string,
  provider: IntelligenceProvider,
): Promise<EnrichmentResult> {
  switch (request.type) {
    case "check_eligibility":
      return await executeEligibilityCheck(request.dni, phoneNumber);

    case "detect_question":
      return await executeDetectQuestion(
        request.message,
        phoneNumber,
        provider,
      );

    case "should_escalate":
      return await executeShouldEscalate(
        request.message,
        phoneNumber,
        provider,
      );

    case "is_product_request":
      return await executeIsProductRequest(
        request.message,
        phoneNumber,
        provider,
      );

    case "extract_bundle_intent":
      return await executeExtractBundleIntent(
        request.message,
        request.affordableBundles,
        phoneNumber,
        provider,
      );

    case "answer_question":
      return await executeAnswerQuestion(
        request.message,
        request.context,
        phoneNumber,
        provider,
      );

    case "generate_backlog_apology":
      return await executeBacklogApology(
        request.message,
        request.ageMinutes,
        phoneNumber,
        provider,
      );

    case "recover_unclear_response":
      return await executeRecoverUnclearResponse(
        request.message,
        request.context,
        phoneNumber,
        provider,
      );
  }
}

async function executeRecoverUnclearResponse(
  message: string,
  context: {
    phase: string;
    lastQuestion?: string;
    expectedOptions?: string[];
  },
  phoneNumber: string,
  provider: IntelligenceProvider,
): Promise<EnrichmentResult> {
  const recoveryText = await safeRecoverUnclearResponse(
    provider,
    message,
    context,
    phoneNumber,
  );
  return { type: "recovery_response", text: recoveryText };
}

async function executeEligibilityCheck(
  dni: string,
  phoneNumber: string,
): Promise<EnrichmentResult> {
  try {
    const result = await checkEligibilityWithFallback(dni, phoneNumber);

    if (result.needsHuman) {
      return {
        type: "eligibility_result",
        status: "needs_human",
        handoffReason: result.handoffReason,
      };
    }

    if (result.eligible) {
      // Determine segment from result or default
      const segment = result.nse !== undefined ? "gaso" : "fnb";
      const credit = result.credit || 0;

      // Fetch affordable categories in same operation
      const affordableCategories = BundleService.getAffordableCategories(
        segment as "fnb" | "gaso",
        credit,
      );

      // Format display names for ready-to-use strings
      const categoryDisplayNames =
        getCategoryDisplayNames(affordableCategories);

      logger.info(
        {
          dni,
          phoneNumber,
          segment,
          credit,
          name: result.name,
        },
        "Customer eligible",
      );

      const affordableBundles = BundleService.getAvailable({
        segment: segment as "fnb" | "gaso",
        maxPrice: credit,
      });

      return {
        type: "eligibility_result",
        status: "eligible",
        segment: segment as "fnb" | "gaso",
        credit,
        name: result.name,
        nse: result.nse,
        requiresAge: segment === "gaso",
        affordableCategories,
        categoryDisplayNames,
        affordableBundles,
      };
    }

    return {
      type: "eligibility_result",
      status: "not_eligible",
    };
  } catch (error) {
    logger.error(
      { error, dni, phoneNumber, enrichmentType: "check_eligibility" },
      "Eligibility check failed",
    );

    return {
      type: "eligibility_result",
      status: "needs_human",
      handoffReason: "eligibility_check_error",
    };
  }
}

async function executeDetectQuestion(
  message: string,
  phoneNumber: string,
  provider: IntelligenceProvider,
): Promise<EnrichmentResult> {
  const isQuestion = await safeIsQuestion(provider, message, phoneNumber);
  return {
    type: "question_detected",
    isQuestion,
  };
}

async function executeShouldEscalate(
  message: string,
  phoneNumber: string,
  provider: IntelligenceProvider,
): Promise<EnrichmentResult> {
  const shouldEscalate = await safeShouldEscalate(
    provider,
    message,
    phoneNumber,
  );
  return {
    type: "escalation_needed",
    shouldEscalate,
  };
}

async function executeIsProductRequest(
  message: string,
  phoneNumber: string,
  provider: IntelligenceProvider,
): Promise<EnrichmentResult> {
  const isProductRequest = await safeIsProductRequest(
    provider,
    message,
    phoneNumber,
  );
  return {
    type: "product_request_detected",
    isProductRequest,
  };
}

async function executeExtractBundleIntent(
  message: string,
  affordableBundles: Bundle[],
  phoneNumber: string,
  provider: IntelligenceProvider,
): Promise<EnrichmentResult> {
  const segment = "fnb";
  const maxPrice =
    affordableBundles.length > 0
      ? Math.max(...affordableBundles.map((b) => b.price))
      : 0;

  const result = await safeExtractBundleIntent(
    provider,
    message,
    phoneNumber,
    segment as "fnb" | "gaso",
    maxPrice,
  );

  return {
    type: "bundle_intent_extracted",
    bundle: result.bundle,
    confidence: result.confidence,
  };
}

async function executeAnswerQuestion(
  message: string,
  context: {
    segment?: string;
    credit?: number;
    phase: string;
    availableCategories: string[];
  },
  phoneNumber: string,
  provider: IntelligenceProvider,
): Promise<EnrichmentResult> {
  const answer = await safeAnswerQuestion(
    provider,
    message,
    context,
    phoneNumber,
  );
  return {
    type: "question_answered",
    answer,
  };
}

async function executeBacklogApology(
  message: string,
  ageMinutes: number,
  phoneNumber: string,
  provider: IntelligenceProvider,
): Promise<EnrichmentResult> {
  const apology = await safeHandleBacklogResponse(
    provider,
    message,
    ageMinutes,
    phoneNumber,
  );
  return {
    type: "backlog_apology",
    apology: apology || "Disculpa la demora, recién vi tu mensaje.",
  };
}

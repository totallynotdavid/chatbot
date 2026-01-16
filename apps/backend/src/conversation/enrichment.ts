import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import { checkEligibilityWithFallback } from "../domains/eligibility/orchestrator.ts";

import * as LLM from "../adapters/llm/index.ts";
import { BundleService } from "../domains/catalog/index.ts";
import { getCategoryDisplayNames } from "../adapters/catalog/display.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("enrichment");

export async function executeEnrichment(
  request: EnrichmentRequest,
  phoneNumber: string,
): Promise<EnrichmentResult> {
  switch (request.type) {
    case "check_eligibility":
      return await executeEligibilityCheck(request.dni, phoneNumber);

    case "detect_question":
      return await executeDetectQuestion(request.message, phoneNumber);

    case "should_escalate":
      return await executeShouldEscalate(request.message, phoneNumber);

    case "extract_category":
      return await executeExtractCategory(
        request.message,
        request.availableCategories,
        phoneNumber,
      );

    case "answer_question":
      return await executeAnswerQuestion(
        request.message,
        request.context,
        phoneNumber,
      );

    case "generate_backlog_apology":
      return await executeBacklogApology(
        request.message,
        request.ageMinutes,
        phoneNumber,
      );

    case "recover_unclear_response":
      return await executeRecoverUnclearResponse(
        request.message,
        request.context,
        phoneNumber,
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
): Promise<EnrichmentResult> {
  const recoveryText = await LLM.recoverUnclearResponse(
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
): Promise<EnrichmentResult> {
  try {
    const isQuestion = await LLM.isQuestion(
      message,
      phoneNumber,
      "offering_products",
    );
    return {
      type: "question_detected",
      isQuestion,
    };
  } catch (error) {
    logger.error(
      { error, phoneNumber, enrichmentType: "detect_question", message },
      "Detect question failed",
    );
    return {
      type: "question_detected",
      isQuestion: false,
    };
  }
}

async function executeShouldEscalate(
  message: string,
  phoneNumber: string,
): Promise<EnrichmentResult> {
  try {
    const shouldEscalate = await LLM.shouldEscalate(
      message,
      phoneNumber,
      "offering_products",
    );
    return {
      type: "escalation_needed",
      shouldEscalate,
    };
  } catch (error) {
    logger.error(
      { error, phoneNumber, enrichmentType: "should_escalate", message },
      "Should escalate check failed",
    );
    return {
      type: "escalation_needed",
      shouldEscalate: false,
    };
  }
}

async function executeExtractCategory(
  message: string,
  availableCategories: string[],
  phoneNumber: string,
): Promise<EnrichmentResult> {
  try {
    const category = await LLM.extractCategory(
      message,
      availableCategories,
      phoneNumber,
      "offering_products",
    );

    return {
      type: "category_extracted",
      category,
    };
  } catch (error) {
    logger.error(
      {
        error,
        phoneNumber,
        enrichmentType: "extract_category",
        message,
        availableCategories,
      },
      "Extract category failed",
    );
    return {
      type: "category_extracted",
      category: null,
    };
  }
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
): Promise<EnrichmentResult> {
  try {
    const answer = await LLM.answerQuestionFocused(
      message,
      {
        segment: context.segment,
        creditLine: context.credit,
        phase: context.phase,
        availableCategories: context.availableCategories,
      },
      phoneNumber,
    );
    return {
      type: "question_answered",
      answer,
    };
  } catch (error) {
    logger.error(
      {
        error,
        phoneNumber,
        enrichmentType: "answer_question",
        message,
        phase: context.phase,
      },
      "Answer question failed",
    );
    return {
      type: "question_answered",
      answer: "Déjame revisar eso y te respondo.",
    };
  }
}

async function executeBacklogApology(
  message: string,
  ageMinutes: number,
  phoneNumber: string,
): Promise<EnrichmentResult> {
  try {
    const apology = await LLM.handleBacklogResponse(
      message,
      ageMinutes,
      phoneNumber,
      "greeting",
    );
    return {
      type: "backlog_apology",
      apology: apology || "Disculpa la demora, recién vi tu mensaje.",
    };
  } catch (error) {
    logger.error(
      {
        error,
        phoneNumber,
        enrichmentType: "generate_backlog_apology",
        ageMinutes,
      },
      "Backlog apology failed",
    );
    return {
      type: "backlog_apology",
      apology: "Disculpa la demora, recién vi tu mensaje.",
    };
  }
}

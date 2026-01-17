import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";
import { safeIsQuestion } from "../../../intelligence/wrapper.ts";

/**
 * Detects whether a user message is a question using an LLM.
 *
 * Routes messages to Q&A or standard conversation flow based on classification.
 *
 * Triggered when the state machine must distinguish questions from statements.
 */
export class DetectQuestionHandler
  implements
    EnrichmentHandler<
      Extract<EnrichmentRequest, { type: "detect_question" }>,
      Extract<EnrichmentResult, { type: "question_detected" }>
    >
{
  readonly type = "detect_question" as const;

  async execute(
    request: Extract<EnrichmentRequest, { type: "detect_question" }>,
    context: EnrichmentContext,
  ): Promise<Extract<EnrichmentResult, { type: "question_detected" }>> {
    const isQuestion = await safeIsQuestion(
      context.provider,
      request.message,
      context.phoneNumber,
    );

    return {
      type: "question_detected",
      isQuestion,
    };
  }
}

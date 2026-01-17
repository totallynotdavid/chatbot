import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type {
  EnrichmentHandler,
  EnrichmentContext,
} from "../handler-interface.ts";
import { safeAnswerQuestion } from "../../../intelligence/wrapper.ts";

/**
 * Answers customer questions using an LLM, grounded in the current conversation,
 * product catalog, and customer context.
 *
 * Triggered when a customer asks a question during any conversation phase.
 */
export class AnswerQuestionHandler
  implements
    EnrichmentHandler<
      Extract<EnrichmentRequest, { type: "answer_question" }>,
      Extract<EnrichmentResult, { type: "question_answered" }>
    >
{
  readonly type = "answer_question" as const;

  async execute(
    request: Extract<EnrichmentRequest, { type: "answer_question" }>,
    context: EnrichmentContext,
  ): Promise<Extract<EnrichmentResult, { type: "question_answered" }>> {
    const answer = await safeAnswerQuestion(
      context.provider,
      request.message,
      request.context,
      context.phoneNumber,
    );

    return {
      type: "question_answered",
      answer,
    };
  }
}

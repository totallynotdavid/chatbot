import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type { EnrichmentHandler, EnrichmentContext } from "../handler-interface.ts";
import { safeIsQuestion } from "../../../intelligence/wrapper.ts";

export class DetectQuestionHandler
    implements
    EnrichmentHandler<
        Extract<EnrichmentRequest, { type: "detect_question" }>,
        Extract<EnrichmentResult, { type: "question_detected" }>
    > {
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

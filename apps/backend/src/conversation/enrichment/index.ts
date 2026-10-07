import { enrichmentRegistry } from "./registry.ts";

import { CheckEligibilityEnrichmentHandler } from "./handlers/check-eligibility-handler.ts";
import { DetectQuestionHandler } from "./handlers/detect-question-handler.ts";
import { ShouldEscalateHandler } from "./handlers/should-escalate-handler.ts";
import { AnswerQuestionHandler } from "./handlers/answer-question-handler.ts";
import { RecoverUnclearResponseHandler } from "./handlers/recover-unclear-response-handler.ts";

import type { CheckEligibilityHandler } from "../../domains/eligibility/handlers/check-eligibility-handler.ts";

export function initializeEnrichmentRegistry(
  eligibilityHandler: CheckEligibilityHandler,
) {
  enrichmentRegistry.register(
    new CheckEligibilityEnrichmentHandler(eligibilityHandler),
  );
  enrichmentRegistry.register(new DetectQuestionHandler());
  enrichmentRegistry.register(new ShouldEscalateHandler());
  enrichmentRegistry.register(new AnswerQuestionHandler());
  enrichmentRegistry.register(new RecoverUnclearResponseHandler());
}

export { enrichmentRegistry };
export type { EnrichmentContext } from "./handler-interface.ts";

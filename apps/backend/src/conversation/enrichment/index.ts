import { enrichmentRegistry } from "./registry.ts";

import { CheckEligibilityEnrichmentHandler } from "./handlers/check-eligibility-handler.ts";
import { DetectQuestionHandler } from "./handlers/detect-question-handler.ts";
import { ShouldEscalateHandler } from "./handlers/should-escalate-handler.ts";
import { IsProductRequestHandler } from "./handlers/is-product-request-handler.ts";
import { ExtractBundleIntentHandler } from "./handlers/extract-bundle-intent-handler.ts";
import { AnswerQuestionHandler } from "./handlers/answer-question-handler.ts";
import { GenerateBacklogApologyHandler } from "./handlers/generate-backlog-apology-handler.ts";
import { RecoverUnclearResponseHandler } from "./handlers/recover-unclear-response-handler.ts";

enrichmentRegistry.register(new CheckEligibilityEnrichmentHandler());
enrichmentRegistry.register(new DetectQuestionHandler());
enrichmentRegistry.register(new ShouldEscalateHandler());
enrichmentRegistry.register(new IsProductRequestHandler());
enrichmentRegistry.register(new ExtractBundleIntentHandler());
enrichmentRegistry.register(new AnswerQuestionHandler());
enrichmentRegistry.register(new GenerateBacklogApologyHandler());
enrichmentRegistry.register(new RecoverUnclearResponseHandler());

export { enrichmentRegistry };
export type { EnrichmentContext } from "./handler-interface.ts";

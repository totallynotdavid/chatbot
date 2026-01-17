import { enrichmentRegistry } from "./registry.ts";

// Import all handlers
import { CheckEligibilityHandler } from "./handlers/check-eligibility-handler.ts";
import { DetectQuestionHandler } from "./handlers/detect-question-handler.ts";
import { ShouldEscalateHandler } from "./handlers/should-escalate-handler.ts";
import { IsProductRequestHandler } from "./handlers/is-product-request-handler.ts";
import { ExtractBundleIntentHandler } from "./handlers/extract-bundle-intent-handler.ts";
import { AnswerQuestionHandler } from "./handlers/answer-question-handler.ts";
import { GenerateBacklogApologyHandler } from "./handlers/generate-backlog-apology-handler.ts";
import { RecoverUnclearResponseHandler } from "./handlers/recover-unclear-response-handler.ts";

// Register all handlers with the singleton registry
enrichmentRegistry.register(new CheckEligibilityHandler());
enrichmentRegistry.register(new DetectQuestionHandler());
enrichmentRegistry.register(new ShouldEscalateHandler());
enrichmentRegistry.register(new IsProductRequestHandler());
enrichmentRegistry.register(new ExtractBundleIntentHandler());
enrichmentRegistry.register(new AnswerQuestionHandler());
enrichmentRegistry.register(new GenerateBacklogApologyHandler());
enrichmentRegistry.register(new RecoverUnclearResponseHandler());

// Export registry and types
export { enrichmentRegistry };
export type { EnrichmentContext } from "./handler-interface.ts";

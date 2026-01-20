import type { Result } from "../../../shared/result/index.ts";
import { Ok, isOk } from "../../../shared/result/index.ts";
import { getWaitingConversations } from "../store/recovery-store.ts";
import { processConversation } from "../processor/conversation-processor.ts";
import type { RecoveryResult } from "../processor/conversation-processor.ts";
import { createLogger } from "../../../lib/logger.ts";

const logger = createLogger("retry-eligibility");

/**
 * Handler for retrying eligibility checks for stuck conversations
 */
export class RetryEligibilityHandler {
  async execute(): Promise<Result<RecoveryResult, Error>> {
    const waitingResult = getWaitingConversations();

    if (!isOk(waitingResult)) {
      logger.error(
        { error: waitingResult.error },
        "Failed to fetch waiting conversations",
      );
      return waitingResult;
    }

    const stuckConversations = waitingResult.value;

    logger.info(
      { count: stuckConversations.length },
      "Starting recovery of stuck conversations",
    );

    const stats: RecoveryResult = {
      recoveredCount: 0,
      stillFailingCount: 0,
      errors: 0,
    };

    for (const row of stuckConversations) {
      await processConversation(row, stats);
    }

    logger.info(stats, "Recovery complete");

    return Ok(stats);
  }
}

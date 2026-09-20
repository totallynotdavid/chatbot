import type { Result } from "../../../shared/result/index.ts";
import { Ok, isOk } from "../../../shared/result/index.ts";
import { getWaitingConversations } from "../store/recovery-store.ts";
import { processConversation } from "../processor/conversation-processor.ts";
import type { RecoveryResult } from "../processor/conversation-processor.ts";
import { createLogger } from "../../../lib/logger.ts";
import type { CheckEligibilityHandler } from "../../eligibility/handlers/check-eligibility-handler.ts";

const logger = createLogger("retry-eligibility");

const NO_WORK: RecoveryResult = {
  recoveredCount: 0,
  stillFailingCount: 0,
  errors: 0,
};

/**
 * The totals plus the same counts per tenant. A platform operator with no
 * tenant selected retries every open tenant in one run, and the audit trail is
 * written from `byTenant`, not from the totals.
 */
export type RecoveryRun = RecoveryResult & {
  byTenant: Record<string, RecoveryResult>;
};

/**
 * Handler for retrying eligibility checks for stuck conversations
 */
export class RetryEligibilityHandler {
  constructor(private eligibilityHandler: CheckEligibilityHandler) {}

  /** `tenantId` null retries the stuck conversations of every open tenant. */
  async execute(
    tenantId: string | null = null,
  ): Promise<Result<RecoveryRun, Error>> {
    const waitingResult = getWaitingConversations(tenantId);

    if (!isOk(waitingResult)) {
      logger.error(
        { error: waitingResult.error },
        "Failed to fetch waiting conversations",
      );
      return waitingResult;
    }

    const stuckConversations = waitingResult.value;

    logger.info(
      { tenantId, count: stuckConversations.length },
      "Starting recovery of stuck conversations",
    );

    const byTenant: Record<string, RecoveryResult> = {};

    for (const row of stuckConversations) {
      const stats = byTenant[row.tenant_id] ?? { ...NO_WORK };
      byTenant[row.tenant_id] = stats;
      await processConversation(row, stats, this.eligibilityHandler);
    }

    const run: RecoveryRun = {
      ...Object.values(byTenant).reduce(
        (totals, stats) => ({
          recoveredCount: totals.recoveredCount + stats.recoveredCount,
          stillFailingCount: totals.stillFailingCount + stats.stillFailingCount,
          errors: totals.errors + stats.errors,
        }),
        NO_WORK,
      ),
      byTenant,
    };

    logger.info(run, "Recovery complete");

    return Ok(run);
  }
}

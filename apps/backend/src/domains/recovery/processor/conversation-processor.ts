import { isOk } from "../../../shared/result/index.ts";
import type { CheckEligibilityHandler } from "../../eligibility/handlers/check-eligibility-handler.ts";
import { executeCommands } from "../../../conversation/handler/command-executor.ts";
import { transitionCheckingEligibility } from "@totem/core";
import { createTraceId } from "@totem/utils";
import { createLogger } from "../../../lib/logger.ts";
import type { ConversationPhase, ConversationMetadata } from "@totem/core";
import type { ConversationRef } from "@totem/types";
import type { WaitingConversation } from "../store/recovery-store.ts";

const logger = createLogger("recovery-processor");

export type RecoveryResult = {
  recoveredCount: number;
  stillFailingCount: number;
  errors: number;
};

export async function processConversation(
  row: WaitingConversation,
  stats: RecoveryResult,
  eligibilityHandler: CheckEligibilityHandler,
): Promise<void> {
  const ref: ConversationRef = {
    tenantId: row.tenant_id,
    channelAccountId: row.channel_account_id,
    phoneNumber: row.phone_number,
  };

  try {
    const context = JSON.parse(row.context_data);
    const phase = context.phase as ConversationPhase & {
      phase: "waiting_for_recovery";
    };
    const metadata = context.metadata as ConversationMetadata;

    logger.debug(
      { tenantId: ref.tenantId, phoneNumber: ref.phoneNumber, dni: phase.dni },
      "Retrying eligibility check",
    );

    // Check eligibility again
    const result = await eligibilityHandler.execute(phase.dni, ref);

    // Check if still failing
    if (isOk(result) && result.value.type === "eligibility_result") {
      if (result.value.status === "system_outage") {
        stats.stillFailingCount++;
        return;
      }
    }

    // Reconstruct checking_eligibility phase with proper type
    const tempPhase: ConversationPhase & { phase: "checking_eligibility" } = {
      phase: "checking_eligibility",
      dni: phase.dni,
    };

    // Get enrichment result
    const enrichmentResult = isOk(result) ? result.value : undefined;

    // Simulate transition
    const transition = transitionCheckingEligibility(
      tempPhase,
      "",
      metadata,
      enrichmentResult,
    );

    if (transition.type === "update") {
      // Add recovery message if eligible
      if (
        enrichmentResult?.type === "eligibility_result" &&
        enrichmentResult.status === "eligible"
      ) {
        transition.commands = [
          {
            type: "SEND_MESSAGE",
            text: "¡Gracias por tu paciencia! Ya recuperamos el sistema y verificamos tu información. 🙌",
          },
          ...transition.commands,
        ];
      }

      await executeCommands(transition, ref, metadata, false, createTraceId());
      stats.recoveredCount++;
    } else {
      logger.warn(
        { tenantId: ref.tenantId, phoneNumber: ref.phoneNumber },
        "Recovery transition failed",
      );
      stats.errors++;
    }
  } catch (error) {
    logger.error(
      { error, tenantId: ref.tenantId, phoneNumber: ref.phoneNumber },
      "Recovery failed for user",
    );
    stats.errors++;
  }
}

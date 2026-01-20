import { isOk } from "../../../shared/result/index.ts";
import { CheckEligibilityHandler } from "../../eligibility/handlers/check-eligibility-handler.ts";
import { executeCommands } from "../../../conversation/handler/command-executor.ts";
import { transitionCheckingEligibility } from "@totem/core";
import { createLogger } from "../../../lib/logger.ts";
import type { ConversationPhase, ConversationMetadata } from "@totem/core";

const logger = createLogger("recovery-processor");

export type RecoveryResult = {
  recoveredCount: number;
  stillFailingCount: number;
  errors: number;
};

export async function processConversation(
  row: { phone_number: string; context_data: string },
  stats: RecoveryResult,
  eligibilityHandler = new CheckEligibilityHandler(),
): Promise<void> {
  try {
    const context = JSON.parse(row.context_data);
    const phase = context.phase as ConversationPhase & {
      phase: "waiting_for_recovery";
    };
    const metadata = context.metadata as ConversationMetadata;

    logger.debug(
      { phoneNumber: row.phone_number, dni: phase.dni },
      "Retrying eligibility check",
    );

    // Check eligibility again
    const result = await eligibilityHandler.execute(
      phase.dni,
      row.phone_number,
    );

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

      await executeCommands(transition, row.phone_number, metadata, false);
      stats.recoveredCount++;
    } else {
      logger.warn(
        { phoneNumber: row.phone_number },
        "Recovery transition failed",
      );
      stats.errors++;
    }
  } catch (error) {
    logger.error(
      { error, phoneNumber: row.phone_number },
      "Recovery failed for user",
    );
    stats.errors++;
  }
}

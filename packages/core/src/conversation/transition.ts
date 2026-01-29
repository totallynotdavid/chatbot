import type { TransitionInput, TransitionResult } from "./types.ts";
import { transitionGreeting } from "./phases/greeting.ts";
import { transitionConfirmingClient } from "./phases/confirming-client.ts";
import { transitionCollectingDni } from "./phases/collecting-dni.ts";
import { transitionCheckingEligibility } from "./phases/checking-eligibility.ts";
import { transitionOfferingDniRetry } from "./phases/offering-dni-retry.ts";
import { transitionCollectingAge } from "./phases/collecting-age.ts";
import { transitionOfferingProducts } from "./phases/offering-products.ts";
import { transitionHandlingObjection } from "./phases/handling-objection.ts";
import { transitionConfirmingSelection } from "./phases/confirming-selection.ts";
import { transitionClosing } from "./phases/closing.ts";

export function transition(input: TransitionInput): TransitionResult {
  const { phase, message, metadata, enrichment, quotedContext } = input;

  switch (phase.phase) {
    case "greeting":
      return transitionGreeting(metadata);

    case "confirming_client":
      return transitionConfirmingClient(message, metadata, enrichment);

    case "collecting_dni":
      return transitionCollectingDni(message, metadata, enrichment);

    case "checking_eligibility":
      return transitionCheckingEligibility(
        phase,
        message,
        metadata,
        enrichment,
      );

    case "offering_dni_retry":
      return transitionOfferingDniRetry(phase, message, metadata, enrichment);

    case "collecting_age":
      return transitionCollectingAge(phase, message, metadata, enrichment);

    case "offering_products":
      return transitionOfferingProducts(
        phase,
        message,
        metadata,
        enrichment,
        quotedContext,
        input.context,
      );

    case "handling_objection":
      return transitionHandlingObjection(phase, message, metadata, enrichment);

    case "confirming_selection":
      return transitionConfirmingSelection(
        phase,
        message,
        metadata,
        enrichment,
      );

    case "closing":
      return transitionClosing(phase, message, metadata, enrichment);

    case "escalated":
    case "waiting_for_recovery":
      // Escalated/waiting state is terminal (no transitions)
      return { type: "update", nextPhase: phase, commands: [] };
  }
}

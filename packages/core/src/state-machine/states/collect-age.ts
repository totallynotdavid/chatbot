import type { StateOutput, Command } from "../types.ts";
import { extractAge } from "../../validation/regex.ts";
import { checkGasoEligibility } from "../../eligibility/gaso-logic.ts";
import * as T from "../../templates/standard.ts";
import * as S from "../../templates/sales.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";

export function handleCollectAge(message: string, context: any): StateOutput {
  const age = extractAge(message);

  if (!age) {
    const { message: invalidMsg, updatedContext: variantCtx } = selectVariant(
      T.INVALID_AGE,
      "INVALID_AGE",
      context,
    );
    return {
      nextState: "COLLECT_AGE",
      commands: [{ type: "SEND_MESSAGE", content: invalidMsg }],
      updatedContext: variantCtx,
    };
  }

  // Validate age against NSE matrix using gaso-logic
  if (
    context.segment === "gaso" &&
    context.nse &&
    context.creditLine !== undefined
  ) {
    const eligibility = checkGasoEligibility(
      age,
      context.nse,
      context.creditLine,
    );

    if (!eligibility.eligible) {
      // Age too low for NSE stratum
      const minAge = context.nse <= 2 ? 40 : context.nse === 3 ? 30 : 18;
      const ageTooLowVariants = T.AGE_TOO_LOW(minAge);
      const { message: ageMsg, updatedContext: variantCtx } = selectVariant(
        ageTooLowVariants,
        "AGE_TOO_LOW",
        context,
      );
      return {
        nextState: "CLOSING",
        commands: [
          { type: "SEND_MESSAGE", content: ageMsg },
          {
            type: "TRACK_EVENT",
            eventType: "eligibility_failed",
            metadata: {
              reason: eligibility.reason,
              age,
              nse: context.nse,
            },
          },
        ],
        updatedContext: { age, ...variantCtx },
      };
    }

    // Age passed, apply NSE credit cap and store max installments
    const gasoOfferVariants = S.GASO_OFFER_KITCHEN_BUNDLE;
    const { message: offerMsg, updatedContext: variantCtx } = selectVariant(
      gasoOfferVariants,
      "GASO_OFFER_KITCHEN_BUNDLE",
      context,
    );
    const commands: Command[] = [
      {
        type: "TRACK_EVENT",
        eventType: "eligibility_passed",
        metadata: {
          segment: "gaso",
          age,
          nse: context.nse,
          rawCredit: context.creditLine,
          cappedCredit: eligibility.maxCredit,
        },
      },
      {
        type: "SEND_MESSAGE",
        content: offerMsg,
      },
    ];

    return {
      nextState: "OFFER_PRODUCTS",
      commands,
      updatedContext: {
        age,
        creditLine: eligibility.maxCredit,
        maxInstallments: eligibility.maxInstallments,
        ...variantCtx,
      },
    };
  }

  // Fallback for non-gaso or missing data
  return {
    nextState: "OFFER_PRODUCTS",
    commands: [
      {
        type: "TRACK_EVENT",
        eventType: "eligibility_passed",
        metadata: { segment: context.segment, age },
      },
    ],
    updatedContext: { age },
  };
}

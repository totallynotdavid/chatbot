import type { TransitionInput, StateOutput } from "./types.ts";
import { sanitizeInput } from "../validation/input-sanitizer.ts";
import * as T from "../templates/standard.ts";
import { selectVariant } from "../messaging/variation-selector.ts";
import { handleInit } from "./states/init.ts";
import { handleConfirmClient } from "./states/confirm-client.ts";
import { handleCollectDNI } from "./states/collect-dni.ts";
import { handleWaitingProvider } from "./states/waiting-provider.ts";
import { handleCollectAge } from "./states/collect-age.ts";
import { handleOfferProducts } from "./states/offer-products.ts";
import { handleObjection } from "./states/handle-objection.ts";
import { handleClosing } from "./states/closing.ts";
import { handleEscalated } from "./states/escalated.ts";

export function transition(input: TransitionInput): StateOutput {
  const message = sanitizeInput(input.message);
  const { currentState, context } = input;

  switch (currentState) {
    case "INIT":
      return handleInit(context);

    case "CONFIRM_CLIENT":
      return handleConfirmClient(message, context);

    case "COLLECT_DNI":
      return handleCollectDNI(message, context);

    case "WAITING_PROVIDER":
      return handleWaitingProvider(context);

    case "COLLECT_AGE":
      return handleCollectAge(message, context);

    case "OFFER_PRODUCTS":
      return handleOfferProducts(message, context);

    case "HANDLE_OBJECTION":
      return handleObjection(message, context);

    case "CLOSING":
      return handleClosing(context);

    case "ESCALATED":
      return handleEscalated(context);

    default: {
      const { message: unclearMsg, updatedContext: unclearCtx } = selectVariant(
        T.UNCLEAR_RESPONSE,
        "UNCLEAR_RESPONSE",
        context,
      );
      return {
        nextState: currentState,
        commands: [{ type: "SEND_MESSAGE", content: unclearMsg }],
        updatedContext: unclearCtx,
      };
    }
  }
}

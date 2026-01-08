import type { StateContext } from "@totem/core";
import type { Conversation } from "@totem/types";
import { checkFNB } from "../../../modules/eligibility/fnb.ts";
import { checkFNBEligibility } from "@totem/core";
import { WhatsAppService } from "../../../services/whatsapp/index.ts";
import { updateConversationState } from "../context.ts";
import { trackEvent } from "../../../services/analytics.ts";
import { selectVariant, formatFirstName } from "@totem/core";
import * as T from "@totem/core";
import { handleCheckGaso } from "./gaso-check.ts";

export async function handleCheckFNB(
  conv: Conversation,
  dni: string,
  context: StateContext,
): Promise<void> {
  const phoneNumber = conv.phone_number;
  const isSimulation = conv.is_simulation === 1;
  const result = await checkFNB(dni, phoneNumber);

  if (result.eligible && checkFNBEligibility(result.credit)) {
    // FNB eligible - select variant for message
    const firstName = formatFirstName(result.name);
    const fnbVariants = T.FNB_APPROVED(firstName, result.credit);
    const { message: approvedMsg, updatedContext: variantCtx } = selectVariant(
      fnbVariants,
      "FNB_APPROVED",
      context,
    );

    // Update state with variant tracking
    updateConversationState(phoneNumber, "OFFER_PRODUCTS", {
      segment: "fnb",
      clientName: result.name,
      creditLine: result.credit,
      ...variantCtx,
    });

    if (isSimulation) {
      WhatsAppService.logMessage(
        phoneNumber,
        "outbound",
        "text",
        approvedMsg,
        "sent",
      );
    } else {
      await WhatsAppService.sendMessage(phoneNumber, approvedMsg);
    }

    trackEvent(phoneNumber, "eligibility_passed", {
      segment: "fnb",
      credit: result.credit,
    });
  } else {
    // Try Gaso as fallback
    await handleCheckGaso(conv, dni, context);
  }
}

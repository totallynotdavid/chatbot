import type { StateContext } from "@totem/core";
import type { Conversation } from "@totem/types";
import { BundleService } from "../../../services/catalog/index.ts";
import { WhatsAppService } from "../../../services/whatsapp/index.ts";
import { updateConversationState } from "../context.ts";
import { selectVariant } from "@totem/core";
import * as T from "@totem/core";
import * as LLM from "../../../services/llm.ts";

export async function handleNoStock(
  conv: Conversation,
  requestedCategory: string,
  context: StateContext,
): Promise<void> {
  const phoneNumber = conv.phone_number;
  const isSimulation = conv.is_simulation === 1;

  let responseMessage: string;

  // If we used LLM to extract the category, use LLM for smart alternative
  if (context.usedLLM) {
    const segment = context.segment || "fnb";
    const availableCategories =
      segment === "fnb"
        ? BundleService.getAvailableCategories("fnb")
        : BundleService.getAvailableCategories("gaso");

    responseMessage = await LLM.suggestAlternative(
      requestedCategory,
      availableCategories,
    );
  } else {
    // Quick match but no stock - use template
    const { message: noStockMsg, updatedContext: variantCtx } = selectVariant(
      T.NO_STOCK,
      "NO_STOCK",
      context,
    );
    responseMessage = noStockMsg;
    updateConversationState(phoneNumber, conv.current_state, variantCtx);
  }

  if (isSimulation) {
    WhatsAppService.logMessage(
      phoneNumber,
      "outbound",
      "text",
      responseMessage,
      "sent",
    );
  } else {
    await WhatsAppService.sendMessage(phoneNumber, responseMessage);
  }
}

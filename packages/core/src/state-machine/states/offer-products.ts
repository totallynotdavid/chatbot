import type { StateOutput } from "../types.ts";
import * as S from "../../templates/sales.ts";
import { selectVariant } from "../../messaging/variation-selector.ts";
import {
  handleCategoryExtraction,
  handleLLMQuestion,
  handleProductSelection,
  handlePurchaseConfirmation,
  handlePriceObjection,
  handleUncertainty,
  handleRejection,
} from "./offer-products-helpers.ts";

export function handleOfferProducts(
  message: string,
  context: any,
): StateOutput {
  // Priority-based handler chain
  const handlers = [
    () => handleCategoryExtraction(context),
    () => handleLLMQuestion(context),
    () => handleProductSelection(message, context),
    () => handlePurchaseConfirmation(message, context),
    () => handlePriceObjection(message, context),
    () => handleUncertainty(message, context),
    () => handleRejection(message, context),
  ];

  for (const handler of handlers) {
    const result = handler();
    if (result) return result;
  }

  // Fallback: unclear request
  const { message: interestMsg, updatedContext: variantCtx } = selectVariant(
    S.ASK_PRODUCT_INTEREST,
    "ASK_PRODUCT_INTEREST",
    context,
  );
  return {
    nextState: "OFFER_PRODUCTS",
    commands: [{ type: "SEND_MESSAGE", content: interestMsg }],
    updatedContext: variantCtx,
  };
}

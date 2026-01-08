import type { StateContext, SentProduct } from "@totem/core";
import type { Conversation } from "@totem/types";
import { BundleService } from "../../../services/catalog/index.ts";
import { WhatsAppService } from "../../../services/whatsapp/index.ts";
import { handleNoStock } from "./no-stock.ts";
import { updateConversationState } from "../context.ts";

/**
 * Sends bundle images to customer with installment details
 * @returns true if bundles were sent, false if no bundles available
 */
export async function sendBundleImages(params: {
  phoneNumber: string;
  segment: "gaso" | "fnb";
  category: string;
  creditLine: number;
  isSimulation: boolean;
}): Promise<boolean> {
  const bundles = BundleService.getAvailable({
    maxPrice: params.creditLine,
    category: params.category,
    segment: params.segment,
  }).slice(0, 3);

  if (bundles.length === 0) {
    return false;
  }

  // Send each bundle image with formatted caption
  for (const bundle of bundles) {
    const installments = JSON.parse(bundle.installments_json);
    const firstOption = installments[0];
    const installmentText = firstOption
      ? `Desde S/ ${firstOption.monthlyAmount.toFixed(2)}/mes (${firstOption.months} cuotas)`
      : "";

    const caption = `${bundle.name}\nPrecio: S/ ${bundle.price.toFixed(2)}${installmentText ? `\n${installmentText}` : ""}`;

    if (params.isSimulation) {
      WhatsAppService.logMessage(
        params.phoneNumber,
        "outbound",
        "image",
        caption,
        "sent",
      );
    } else {
      await WhatsAppService.sendImage(
        params.phoneNumber,
        `images/${bundle.image_id}.jpg`,
        caption,
      );
    }
  }

  return true;
}

export async function handleSendImages(
  conv: Conversation,
  category: string,
  context: StateContext,
): Promise<void> {
  const phoneNumber = conv.phone_number;
  const isSimulation = conv.is_simulation === 1;
  const segment = context.segment || "fnb";
  const creditLine = context.creditLine || 0;

  // Get available bundles
  const bundles = BundleService.getAvailable({
    maxPrice: creditLine,
    category,
    segment,
  }).slice(0, 3);

  if (bundles.length === 0) {
    await handleNoStock(conv, category, context);
    return;
  }

  // Track sent products for smart selection matching
  const sentProducts: SentProduct[] = bundles.map((bundle, index) => ({
    id: bundle.id,
    name: bundle.name,
    position: index + 1, // 1-based
  }));

  // Send each bundle image with formatted caption
  for (const bundle of bundles) {
    const installments = JSON.parse(bundle.installments_json);
    const firstOption = installments[0];
    const installmentText = firstOption
      ? `Desde S/ ${firstOption.monthlyAmount.toFixed(2)}/mes (${firstOption.months} cuotas)`
      : "";

    const caption = `${bundle.name}\nPrecio: S/ ${bundle.price.toFixed(2)}${installmentText ? `\n${installmentText}` : ""}`;

    if (isSimulation) {
      WhatsAppService.logMessage(
        phoneNumber,
        "outbound",
        "image",
        caption,
        "sent",
      );
    } else {
      await WhatsAppService.sendImage(
        phoneNumber,
        `images/${bundle.image_id}.jpg`,
        caption,
      );
    }
  }

  // Update conversation context with sent products
  updateConversationState(phoneNumber, conv.current_state, {
    sentProducts,
  });

  // Send follow-up message
  const followUp =
    segment === "gaso"
      ? "¿Te gustaría llevarte alguno de estos?"
      : "¿Alguno te interesa?";

  if (isSimulation) {
    WhatsAppService.logMessage(
      phoneNumber,
      "outbound",
      "text",
      followUp,
      "sent",
    );
  } else {
    await WhatsAppService.sendMessage(phoneNumber, followUp);
  }
}

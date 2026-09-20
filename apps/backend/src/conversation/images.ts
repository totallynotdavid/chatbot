import type { ConversationRef, Segment } from "@totem/types";
import { BundleService } from "../domains/catalog/index.ts";
import { WhatsAppService } from "../adapters/whatsapp/index.ts";

export type SendBundleParams = {
  ref: ConversationRef;
  segment: Segment;
  category?: string;
  creditLine: number;
  isSimulation: boolean;
  offset?: number;
  query?: string;
};

export type SendBundleResult = {
  success: boolean;
  products: Array<{
    name: string;
    position: number;
    productId: string;
    price: number;
  }>;
};

/**
 * Send bundle images to customer with installment details
 * @returns `success` when at least one image went out, and only the products
 * whose image was accepted, at the position they had among the bundles
 */
export async function sendBundleImages(
  params: SendBundleParams,
): Promise<SendBundleResult> {
  const { ref, segment, category, creditLine, isSimulation, offset, query } =
    params;

  const strictPriceLimit = segment === "gaso";

  const bundles = BundleService.getAvailable(ref.tenantId, {
    maxPrice: creditLine,
    category,
    segment,
    strictPriceLimit,
    offset: offset || 0,
    query,
  });

  if (bundles.length === 0) {
    return { success: false, products: [] };
  }

  const sentProducts = [];

  // Send each bundle image with formatted caption
  for (const [index, bundle] of bundles.entries()) {
    const installments = JSON.parse(bundle.installments_json);
    const firstOption = installments[0];
    const installmentText = firstOption
      ? `Desde S/ ${firstOption.monthlyAmount.toFixed(2)}/mes (${firstOption.months} cuotas)`
      : "";

    const caption = `${bundle.name}\nPrecio: S/ ${bundle.price.toFixed(2)}${installmentText ? `\n${installmentText}` : ""}`;

    if (isSimulation) {
      WhatsAppService.logMessage(ref, "outbound", "image", caption, "sent");
    } else {
      const outcome = await WhatsAppService.sendImage(
        ref,
        `images/${bundle.image_id}.jpg`,
        caption,
        bundle.id, // Pass product ID for tracking
      );
      if (!outcome.ok) continue;
    }

    sentProducts.push({
      name: bundle.name,
      position: index + 1,
      productId: bundle.id,
      price: bundle.price,
    });
  }

  if (sentProducts.length === 0) {
    return { success: false, products: [] };
  }

  // Send follow-up message
  const followUp =
    segment === "gaso"
      ? "¿Te gustaría llevarte alguno de estos?"
      : "¿Alguno te interesa?";

  if (isSimulation) {
    WhatsAppService.logMessage(ref, "outbound", "text", followUp, "sent");
  } else {
    await WhatsAppService.sendMessage(ref, followUp);
  }

  return { success: true, products: sentProducts };
}

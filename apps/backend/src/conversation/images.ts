import type { Segment } from "@totem/types";
import { BundleService } from "../services/catalog/index.ts";
import { WhatsAppService } from "../services/whatsapp/index.ts";

export type SendBundleParams = {
  phoneNumber: string;
  segment: Segment;
  category: string;
  creditLine: number;
  isSimulation: boolean;
};

/**
 * Send bundle images to customer with installment details
 * @returns true if bundles were sent, false if no bundles available
 */
export async function sendBundleImages(
  params: SendBundleParams,
): Promise<boolean> {
  const { phoneNumber, segment, category, creditLine, isSimulation } = params;

  const bundles = BundleService.getAvailable({
    maxPrice: creditLine,
    category,
    segment,
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

  return true;
}

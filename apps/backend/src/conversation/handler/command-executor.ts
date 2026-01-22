import type {
  ConversationPhase,
  ConversationMetadata,
  TransitionResult,
  Command,
} from "@totem/core";
import { WhatsAppService } from "../../adapters/whatsapp/index.ts";
import { notifyTeam } from "../../adapters/notifier/client.ts";
import { sendBundleImages } from "../images.ts";
import { trackEvent } from "../../domains/analytics/index.ts";
import { BundleService } from "../../domains/catalog/index.ts";
import { getOrCreateConversation, updateConversation } from "../store.ts";
import { sleep } from "./sleep.ts";
import { createLogger } from "../../lib/logger.ts";
import { getFrontendUrl } from "@totem/utils";

const logger = createLogger("commands");

function formatTeamNotification(
  originalMessage: string,
  phoneNumber: string,
  phase: ConversationPhase,
  metadata: ConversationMetadata,
): string {
  const name =
    metadata.name || ("name" in phase ? phase.name : null) || "No disponible";
  const dni =
    metadata.dni || ("dni" in phase ? phase.dni : null) || "No disponible";
  const telefono = phoneNumber;

  let producto = "No disponible";
  if (
    "selectedProduct" in phase &&
    phase.selectedProduct &&
    phase.selectedProduct.name
  ) {
    const price = phase.selectedProduct.price || 0;
    producto = `${phase.selectedProduct.name} (S/ ${price.toFixed(2)})`;
  } else if (
    "interestedProduct" in phase &&
    phase.interestedProduct &&
    phase.interestedProduct.name
  ) {
    const price = phase.interestedProduct.price || 0;
    producto = `${phase.interestedProduct.name} (S/ ${price.toFixed(2)})`;
  }

  // Build the formatted message
  const header = `Nombre: ${name}\nDNI: ${dni}\nTeléfono: ${telefono}\nProducto: ${producto}`;

  // Add URL for purchase confirmations
  let urlSection = "";
  if (
    originalMessage.includes("confirmó compra") ||
    originalMessage.includes("VENTA")
  ) {
    const frontendUrl = getFrontendUrl();
    urlSection = `\n\nVer conversación: ${frontendUrl}/dashboard/conversations/${phoneNumber}`;
  }

  return `${header}${urlSection}\n\n${originalMessage}`;
}
export async function executeCommands(
  result: TransitionResult,
  phoneNumber: string,
  metadata: ConversationMetadata,
  isSimulation: boolean,
): Promise<void> {
  if (result.type === "need_enrichment") {
    // Should not reach here, enrichment loop should handle it
    logger.error(
      { phoneNumber, resultType: result.type },
      "Unexpected need_enrichment in executeCommands",
    );
    await notifyTeam(
      "dev",
      `Error en ejecución de comandos\n\nNombre: ${metadata.name || "No disponible"}\nDNI: ${metadata.dni || "No disponible"}\nTeléfono: ${phoneNumber}\nProducto: No disponible`,
    );
    return;
  }

  const currentConversation = getOrCreateConversation(phoneNumber);
  if (
    JSON.stringify(currentConversation.phase) !==
    JSON.stringify(result.nextPhase)
  ) {
    logger.info(
      {
        phoneNumber,
        fromPhase: currentConversation.phase.phase,
        toPhase: result.nextPhase.phase,
      },
      "Phase transition",
    );
    updateConversation(phoneNumber, result.nextPhase, metadata);
  }

  for (let i = 0; i < result.commands.length; i++) {
    const command = result.commands[i];
    if (!command) continue;

    // Add 1 second delay between SEND_MESSAGE commands for natural pacing
    if (i > 0 && command.type === "SEND_MESSAGE") {
      const prevCommand = result.commands[i - 1];
      if (prevCommand?.type === "SEND_MESSAGE") {
        await sleep(1000);
      }
    }

    await executeCommand(
      command,
      phoneNumber,
      result.nextPhase,
      metadata,
      isSimulation,
    );
  }
}

async function executeCommand(
  command: Command,
  phoneNumber: string,
  phase: ConversationPhase,
  metadata: ConversationMetadata,
  isSimulation: boolean,
): Promise<void> {
  switch (command.type) {
    case "SEND_MESSAGE":
      await sendMessage(phoneNumber, command.text, isSimulation);
      break;

    case "SEND_IMAGES":
      await executeImages(command, phoneNumber, phase, isSimulation);
      break;

    case "SEND_BUNDLE":
      await executeSingleBundle(command, phoneNumber, phase, isSimulation);
      break;

    case "TRACK_EVENT":
      trackEvent(phoneNumber, command.event, {
        segment: metadata.segment,
        ...command.metadata,
      });
      break;

    case "NOTIFY_TEAM":
      const enrichedMessage = formatTeamNotification(
        command.message,
        phoneNumber,
        phase,
        metadata,
      );
      await notifyTeam(command.channel, enrichedMessage);
      break;

    case "ESCALATE":
      // Phase update already handled in executeCommands
      logger.warn(
        { phoneNumber, reason: command.reason },
        "Conversation escalated",
      );
      break;
  }
}

async function sendMessage(
  phoneNumber: string,
  content: string,
  isSimulation: boolean,
): Promise<void> {
  if (isSimulation) {
    WhatsAppService.logMessage(
      phoneNumber,
      "outbound",
      "text",
      content,
      "sent",
    );
  } else {
    await WhatsAppService.sendMessage(phoneNumber, content);
  }
}

async function executeImages(
  command: Extract<Command, { type: "SEND_IMAGES" }>,
  phoneNumber: string,
  phase: ConversationPhase,
  isSimulation: boolean,
): Promise<void> {
  if (
    phase.phase !== "offering_products" &&
    phase.phase !== "handling_objection"
  ) {
    logger.warn(
      { phoneNumber, currentPhase: phase.phase },
      "Images requested outside offering phase",
    );
    return;
  }

  const credit = "credit" in phase ? phase.credit : 0;
  const segment = "segment" in phase ? phase.segment : "fnb";

  const result = await sendBundleImages({
    phoneNumber,
    segment,
    category: command.category,
    creditLine: credit,
    isSimulation,
    offset: command.offset,
    query: command.query,
  });

  // Update phase with sent products for validation in next message
  if (result.success && result.products.length > 0) {
    const updatedPhase: ConversationPhase = {
      ...phase,
      sentProducts: result.products,
      lastAction: {
        type: "showed_products",
        category: command.category,
        productCount: result.products.length,
        timestamp: Date.now(),
      },
    } as ConversationPhase;
    const conversation = getOrCreateConversation(phoneNumber);
    updateConversation(phoneNumber, updatedPhase, conversation.metadata);
  }
}

async function executeSingleBundle(
  command: Extract<Command, { type: "SEND_BUNDLE" }>,
  phoneNumber: string,
  phase: ConversationPhase,
  isSimulation: boolean,
): Promise<void> {
  if (
    phase.phase !== "offering_products" &&
    phase.phase !== "handling_objection"
  ) {
    logger.warn(
      { phoneNumber, currentPhase: phase.phase },
      "Bundle requested outside offering phase",
    );
    return;
  }

  const bundle = BundleService.getById(command.bundleId);

  if (!bundle) {
    logger.warn(
      { phoneNumber, bundleId: command.bundleId },
      "Bundle not found",
    );
    return;
  }

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
      bundle.id,
    );
  }

  // Update phase with sent product
  const updatedPhase: ConversationPhase = {
    ...phase,
    sentProducts: [
      {
        name: bundle.name,
        position: 1,
        productId: bundle.id,
        price: bundle.price,
      },
    ],
    lastAction: {
      type: "showed_products",
      category: bundle.primary_category,
      productCount: 1,
      timestamp: Date.now(),
    },
  } as ConversationPhase;

  const conversation = getOrCreateConversation(phoneNumber);
  updateConversation(phoneNumber, updatedPhase, conversation.metadata);
}

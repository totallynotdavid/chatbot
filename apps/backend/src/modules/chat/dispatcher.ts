import type { Command } from "@totem/core";
import type { StateContext } from "@totem/core";
import type { Conversation } from "@totem/types";
import { handleCheckFNB } from "./handlers/fnb-check.ts";
import { handleCheckGaso } from "./handlers/gaso-check.ts";
import { handleSendImages } from "./handlers/bundle-sender.ts";
import { WhatsAppService } from "../../services/whatsapp/index.ts";
import { notifyTeam } from "../../services/notifier.ts";
import { trackEvent } from "../../services/analytics.ts";
import { escalateConversation } from "./context.ts";

export async function executeCommand(
  conv: Conversation,
  command: Command,
  context: StateContext,
): Promise<void> {
  const phoneNumber = conv.phone_number;
  const isSimulation = conv.is_simulation === 1;

  switch (command.type) {
    case "CHECK_FNB":
      await handleCheckFNB(conv, command.dni, context);
      break;

    case "CHECK_GASO":
      await handleCheckGaso(conv, command.dni, context);
      break;

    case "SEND_MESSAGE":
      if (isSimulation) {
        WhatsAppService.logMessage(
          phoneNumber,
          "outbound",
          "text",
          command.content,
          "sent",
        );
      } else {
        await WhatsAppService.sendMessage(phoneNumber, command.content);
      }
      break;

    case "SEND_IMAGES":
      await handleSendImages(conv, command.category, context);
      break;

    case "NOTIFY_TEAM":
      if (!isSimulation) {
        await notifyTeam(command.channel, command.message);
      }
      break;

    case "TRACK_EVENT":
      trackEvent(phoneNumber, command.eventType, command.metadata);
      break;

    case "ESCALATE":
      escalateConversation(phoneNumber, command.reason);
      break;
  }
}

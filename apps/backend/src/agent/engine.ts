import { transition } from "@totem/core";
import type { Conversation } from "@totem/types";
import {
  getOrCreateConversation,
  updateConversationState,
  buildStateContext,
  checkSessionTimeout,
  resetSession,
} from "./context.ts";
import { isMaintenanceMode } from "../modules/settings/system.ts";
import { WhatsAppService } from "../services/whatsapp/index.ts";
import * as LLM from "../services/llm.ts";
import { BundleService } from "../services/catalog/index.ts";
import { assignNextAgent } from "../services/assignment.ts";
import { executeCommand } from "./commands/dispatcher.ts";

const MAINTENANCE_MESSAGE =
  "¡Hola! 👋 En este momento estamos realizando mejoras en nuestro sistema. " +
  "Por favor, inténtalo de nuevo en unos minutos. ¡Gracias por tu paciencia!";

export async function processMessage(
  phoneNumber: string,
  message: string,
  metadata?: { isBacklog: boolean; oldestMessageAge: number },
): Promise<void> {
  // Check maintenance mode before processing
  if (isMaintenanceMode()) {
    await WhatsAppService.sendMessage(phoneNumber, MAINTENANCE_MESSAGE);
    return;
  }

  const conv = getOrCreateConversation(phoneNumber);

  // Reset terminal states immediately on new user message
  if (conv.current_state === "CLOSING" || conv.current_state === "ESCALATED") {
    resetSession(phoneNumber);
    const resetConv = getOrCreateConversation(phoneNumber);
    await executeTransition(resetConv, message, metadata);
    return;
  }

  // Check for session timeout (3 hours)
  if (checkSessionTimeout(conv) && conv.current_state !== "INIT") {
    resetSession(phoneNumber);
    const resetConv = getOrCreateConversation(phoneNumber);
    await executeTransition(resetConv, message, metadata);
    return;
  }

  await executeTransition(conv, message, metadata);
}

async function executeTransition(
  conv: Conversation,
  message: string,
  metadata?: { isBacklog: boolean; oldestMessageAge: number },
): Promise<void> {
  const context = buildStateContext(conv);
  const state = conv.current_state;

  // BACKLOG: If client sent messages while bot was offline
  if (metadata?.isBacklog && state === "INIT") {
    const ageMinutes = Math.floor(metadata.oldestMessageAge / 60000);
    const backlogResponse = await LLM.handleBacklogResponse(
      message,
      ageMinutes,
    );

    // Send LLM-generated contextual response acknowledging the delay
    await WhatsAppService.sendMessage(conv.phone_number, backlogResponse);

    // Continue processing normally
  }

  // SELECTIVE LLM ENRICHMENT (backend pre-processing)

  // 1. Detect questions at any state (except INIT)
  if (state !== "INIT" && state !== "WAITING_PROVIDER") {
    const intent = await LLM.classifyIntent(message);

    if (intent === "question") {
      // Generate LLM answer for the question
      const questionResponse = await LLM.answerQuestion(message, {
        segment: context.segment,
        creditLine: context.creditLine,
        state,
      });

      context.llmDetectedQuestion = true;
      context.llmGeneratedAnswer = questionResponse.answer;
      context.llmRequiresHuman = questionResponse.requiresHuman;
    }
  }

  // 2. Extract product category (in OFFER_PRODUCTS state)
  if (state === "OFFER_PRODUCTS") {
    // Fast path: Try category matcher first (90% of cases)
    const { matchCategory } = await import("@totem/core");
    const matchedCategory = matchCategory(message);

    if (matchedCategory) {
      // Quick match via aliases/brands
      context.extractedCategory = matchedCategory;
      context.usedLLM = false;
    } else {
      // No quick match - use LLM for ambiguous cases
      const availableCategories =
        context.segment === "fnb"
          ? BundleService.getAvailableCategories("fnb")
          : BundleService.getAvailableCategories("gaso");

      const category = await LLM.extractEntity(message, "product_category", {
        availableCategories,
      });

      if (category) {
        context.extractedCategory = category;
        context.usedLLM = true;
      }
    }
  }

  // Core transition with enriched context
  const output = transition({
    currentState: conv.current_state,
    message,
    context,
  });

  // Update state first
  updateConversationState(
    conv.phone_number,
    output.nextState,
    output.updatedContext,
  );

  // Check if purchase was confirmed and trigger agent assignment
  if (output.updatedContext.purchaseConfirmed && !conv.is_simulation) {
    await assignNextAgent(conv.phone_number, conv.client_name);
  }

  // Execute commands
  for (const command of output.commands) {
    await executeCommand(conv, command, context);
  }
}

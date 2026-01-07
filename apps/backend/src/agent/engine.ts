import { transition } from "@totem/core";
import { checkFNBEligibility } from "@totem/core";
import type { Command, StateContext } from "@totem/core";
import type { Conversation } from "@totem/types";
import {
  getOrCreateConversation,
  updateConversationState,
  escalateConversation,
  buildStateContext,
  checkSessionTimeout,
  resetSession,
} from "./context.ts";
import {
  FNBProvider,
  GasoProvider,
  isMaintenanceMode,
} from "../services/providers.ts";
import { WhatsAppService } from "../services/whatsapp/index.ts";
import { trackEvent } from "../services/analytics.ts";
import { notifyTeam } from "../services/notifier.ts";
import { BundleService } from "../services/catalog/index.ts";
import * as LLM from "../services/llm.ts";
import * as T from "@totem/core";
import { selectVariant, formatFirstName } from "@totem/core";
import { assignNextAgent } from "../services/assignment.ts";

const MAINTENANCE_MESSAGE =
  "¡Hola! 👋 En este momento estamos realizando mejoras en nuestro sistema. " +
  "Por favor, inténtalo de nuevo en unos minutos. ¡Gracias por tu paciencia!";

export async function processMessage(
  phoneNumber: string,
  message: string,
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
    await executeTransition(resetConv, message);
    return;
  }

  // Check for session timeout (3 hours)
  if (checkSessionTimeout(conv) && conv.current_state !== "INIT") {
    resetSession(phoneNumber);
    const resetConv = getOrCreateConversation(phoneNumber);
    await executeTransition(resetConv, message);
    return;
  }

  await executeTransition(conv, message);
}

async function executeTransition(
  conv: Conversation,
  message: string,
): Promise<void> {
  const context = buildStateContext(conv);
  const state = conv.current_state;

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

async function executeCommand(
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
        // In simulator mode, just log locally without calling WhatsApp API
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
      // Skip team notifications in simulator mode
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

async function handleCheckFNB(
  conv: Conversation,
  dni: string,
  context: StateContext,
): Promise<void> {
  const phoneNumber = conv.phone_number;
  const isSimulation = conv.is_simulation === 1;
  const result = await FNBProvider.checkCredit(dni, phoneNumber);

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

async function handleCheckGaso(
  conv: Conversation,
  dni: string,
  context: StateContext,
): Promise<void> {
  const phoneNumber = conv.phone_number;
  const isSimulation = conv.is_simulation === 1;
  const result = await GasoProvider.checkEligibility(dni, phoneNumber);

  // Check if PowerBI is down and we used fallback (notify dev team once)
  if (
    !isSimulation &&
    (result.reason?.startsWith("powerbi_down") ||
      result.reason === "powerbi_failed_used_fallback")
  ) {
    await notifyTeam(
      "dev",
      `[ALERT] PowerBI is DOWN. Using Calidda fallback\n` +
        `Reason: ${result.reason}\n` +
        `DNI: ${dni}\n` +
        `Eligible: ${result.eligible}\n` +
        `Credit: S/ ${result.credit}\n` +
        `Phone: ${phoneNumber}`,
    );
  }

  if (!result.eligible) {
    // Check if it's an API error (provider unavailable)
    if (
      result.reason === "api_error" ||
      result.reason === "provider_unavailable" ||
      result.reason === "all_providers_down"
    ) {
      // Notify team about provider issues (skip in simulation)
      if (!isSimulation) {
        await notifyTeam(
          "dev",
          `[ALERT] GASO Provider unavailable\nDNI: ${dni}\nReason: ${result.reason}\nPhone: ${phoneNumber}`,
        );
      }

      // Escalate to human since we can't verify eligibility
      const { message: handoffMsg, updatedContext: variantCtx } =
        T.selectVariantWithContext(
          T.HANDOFF_TO_HUMAN,
          "HANDOFF_TO_HUMAN",
          context,
        );
      updateConversationState(phoneNumber, "ESCALATED", variantCtx);

      if (isSimulation) {
        WhatsAppService.logMessage(
          phoneNumber,
          "outbound",
          "text",
          handoffMsg,
          "sent",
        );
      } else {
        await WhatsAppService.sendMessage(phoneNumber, handoffMsg);
      }

      escalateConversation(phoneNumber, "gaso_provider_unavailable");
      trackEvent(phoneNumber, "provider_error", {
        provider: "gaso",
        reason: result.reason,
      });
      return;
    }

    // Not eligible in either system
    const { message: notEligibleMsg, updatedContext: variantCtx } =
      selectVariant(T.NOT_ELIGIBLE, "NOT_ELIGIBLE", context);
    updateConversationState(phoneNumber, "CLOSING", variantCtx);

    if (isSimulation) {
      WhatsAppService.logMessage(
        phoneNumber,
        "outbound",
        "text",
        notEligibleMsg,
        "sent",
      );
    } else {
      await WhatsAppService.sendMessage(phoneNumber, notEligibleMsg);
    }

    trackEvent(phoneNumber, "eligibility_failed", {
      reason: result.reason || "not_found",
    });
    return;
  }

  // Check Gaso eligibility matrix (need age first)
  const firstName = formatFirstName(result.name);
  const ageVariants = T.ASK_AGE(firstName);
  const { message: ageMsg, updatedContext: variantCtx } = selectVariant(
    ageVariants,
    "ASK_AGE",
    context,
  );

  updateConversationState(phoneNumber, "COLLECT_AGE", {
    segment: "gaso",
    clientName: result.name,
    creditLine: result.credit,
    nse: result.nse,
    ...variantCtx,
  });

  if (isSimulation) {
    WhatsAppService.logMessage(phoneNumber, "outbound", "text", ageMsg, "sent");
  } else {
    await WhatsAppService.sendMessage(phoneNumber, ageMsg);
  }
}

async function handleSendImages(
  conv: Conversation,
  category: string,
  context: StateContext,
): Promise<void> {
  const phoneNumber = conv.phone_number;
  const isSimulation = conv.is_simulation === 1;
  const segment = context.segment || "fnb";
  const creditLine = context.creditLine || 0;

  // Get products based on segment (GASO = bundles, FNB = offerings)
  if (segment === "gaso") {
    const bundles = BundleService.getAvailable({
      maxPrice: creditLine,
      category,
      segment: "gaso",
    }).slice(0, 3);

    if (bundles.length === 0) {
      await handleNoStock(conv, category, context);
      return;
    }

    for (const bundle of bundles) {
      // Format installments info from schedule
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

    // Send follow-up question after showing products
    const followUp = "¿Te gustaría llevarte alguno de estos?";
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
  } else {
    // FNB segment - individual offerings
    const offerings = BundleService.getAvailable({
      maxPrice: creditLine,
      category,
      segment: "fnb",
    }).slice(0, 3);

    if (offerings.length === 0) {
      await handleNoStock(conv, category, context);
      return;
    }

    for (const offering of offerings) {
      // Format installments info from schedule
      const installments = JSON.parse(offering.installments_json);
      const firstOption = installments[0];
      const installmentText = firstOption
        ? `Desde S/ ${firstOption.monthlyAmount.toFixed(2)}/mes (${firstOption.months} cuotas)`
        : "";

      const caption = `${offering.name}\nPrecio: S/ ${offering.price.toFixed(2)}${installmentText ? `\n${installmentText}` : ""}`;

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
          `images/${offering.image_id}.jpg`,
          caption,
        );
      }
    }

    // Send follow-up question after showing products
    const followUp = "¿Alguno te interesa?";
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
}

async function handleNoStock(
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

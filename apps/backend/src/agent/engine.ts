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
import { FNBProvider, GasoProvider } from "../services/providers.ts";
import { WhatsAppService } from "../services/whatsapp.ts";
import { trackEvent } from "../services/analytics.ts";
import { notifyTeam } from "../services/notifier.ts";
import { CatalogService } from "../services/catalog.ts";
import * as LLM from "../services/llm.ts";
import * as T from "@totem/core";
import { selectVariant, selectVariantWithContext, formatFirstName } from "@totem/core";

export async function processMessage(
    phoneNumber: string,
    message: string,
): Promise<void> {
    const conv = getOrCreateConversation(phoneNumber);

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
    if (state === "OFFER_PRODUCTS" && !context.offeredCategory) {
        // Get available categories from database for this segment
        const availableCategories = CatalogService.getAvailableCategories(context.segment);

        const category = await LLM.extractEntity(message, "product_category", {
            availableCategories,
        });
        if (category) {
            context.llmExtractedCategory = category;
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
                WhatsAppService.logMessage(phoneNumber, "outbound", "text", command.content, "sent");
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
    const result = await FNBProvider.checkCredit(dni);

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
            WhatsAppService.logMessage(phoneNumber, "outbound", "text", approvedMsg, "sent");
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
    const result = await GasoProvider.checkEligibility(dni);

    // Check if PowerBI is down and we used fallback (notify dev team once)
    if (!isSimulation && (result.reason?.startsWith("powerbi_down") || result.reason === "powerbi_failed_used_fallback")) {
        await notifyTeam(
            "dev",
            `[ALERT] PowerBI is DOWN - Using Calidda fallback\n` +
            `Reason: ${result.reason}\n` +
            `DNI: ${dni}\n` +
            `Eligible: ${result.eligible}\n` +
            `Credit: S/ ${result.credit}\n` +
            `Phone: ${phoneNumber}`,
        );
    }

    if (!result.eligible) {
        // Check if it's an API error (provider unavailable)
        if (result.reason === "api_error" || result.reason === "provider_unavailable" || result.reason === "all_providers_down") {
            // Notify team about provider issues (skip in simulation)
            if (!isSimulation) {
                await notifyTeam(
                    "dev",
                    `[ALERT] GASO Provider unavailable\nDNI: ${dni}\nReason: ${result.reason}\nPhone: ${phoneNumber}`,
                );
            }

            // Escalate to human since we can't verify eligibility
            const { message: handoffMsg, updatedContext: variantCtx } = T.selectVariantWithContext(
                T.HANDOFF_TO_HUMAN,
                "HANDOFF_TO_HUMAN",
                context,
            );
            updateConversationState(phoneNumber, "ESCALATED", variantCtx);

            if (isSimulation) {
                WhatsAppService.logMessage(phoneNumber, "outbound", "text", handoffMsg, "sent");
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
        const { message: notEligibleMsg, updatedContext: variantCtx } = selectVariant(
            T.NOT_ELIGIBLE,
            "NOT_ELIGIBLE",
            context,
        );
        updateConversationState(phoneNumber, "CLOSING", variantCtx);

        if (isSimulation) {
            WhatsAppService.logMessage(phoneNumber, "outbound", "text", notEligibleMsg, "sent");
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

    let products = CatalogService.getBySegment(segment).filter((p) =>
        p.category.toLowerCase().includes(category.toLowerCase()),
    );

    // Filter by available credit for both FNB and Gaso clients
    // Note: creditLine of 0 means no credit, should return no products
    products = products.filter((p) => p.price <= creditLine);

    // Take top 3 products
    products = products.slice(0, 3);

    if (products.length === 0) {
        const { message: noStockMsg, updatedContext: variantCtx } = selectVariant(
            T.NO_STOCK,
            "NO_STOCK",
            context,
        );
        updateConversationState(phoneNumber, conv.current_state, variantCtx);

        if (isSimulation) {
            WhatsAppService.logMessage(phoneNumber, "outbound", "text", noStockMsg, "sent");
        } else {
            await WhatsAppService.sendMessage(phoneNumber, noStockMsg);
        }
        return;
    }

    for (const product of products) {
        const caption = `${product.name}\nPrecio: S/ ${product.price.toFixed(2)}${product.installments ? `\nCuotas: ${product.installments} meses` : ""}`;

        if (isSimulation) {
            WhatsAppService.logMessage(phoneNumber, "outbound", "image", caption, "sent");
        } else {
            await WhatsAppService.sendImage(phoneNumber, product.image_main_path, caption);
        }
    }
}

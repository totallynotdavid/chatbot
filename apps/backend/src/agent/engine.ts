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
import * as T from "@totem/core";

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
        await executeCommand(conv.phone_number, command, context);
    }
}

async function executeCommand(
    phoneNumber: string,
    command: Command,
    context: StateContext,
): Promise<void> {
    switch (command.type) {
        case "CHECK_FNB":
            await handleCheckFNB(phoneNumber, command.dni, context);
            break;

        case "CHECK_GASO":
            await handleCheckGaso(phoneNumber, command.dni, context);
            break;

        case "SEND_MESSAGE":
            await WhatsAppService.sendMessage(phoneNumber, command.content);
            break;

        case "SEND_IMAGES":
            await handleSendImages(phoneNumber, command.category, context);
            break;

        case "NOTIFY_TEAM":
            await notifyTeam(command.channel, command.message);
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
    phoneNumber: string,
    dni: string,
    context: StateContext,
): Promise<void> {
    const result = await FNBProvider.checkCredit(dni);

    if (result.eligible && checkFNBEligibility(result.credit)) {
        // FNB eligible - update and transition
        updateConversationState(phoneNumber, "OFFER_PRODUCTS", {
            segment: "fnb",
            clientName: result.name,
            creditLine: result.credit,
        });

        await WhatsAppService.sendMessage(
            phoneNumber,
            T.FNB_APPROVED(result.name || "Cliente", result.credit),
        );

        trackEvent(phoneNumber, "eligibility_passed", {
            segment: "fnb",
            credit: result.credit,
        });
    } else {
        // Try Gaso as fallback
        await handleCheckGaso(phoneNumber, dni, context);
    }
}

async function handleCheckGaso(
    phoneNumber: string,
    dni: string,
    context: StateContext,
): Promise<void> {
    const result = await GasoProvider.checkEligibility(dni);

    if (!result.eligible) {
        // Not eligible in either system
        updateConversationState(phoneNumber, "CLOSING", {});
        await WhatsAppService.sendMessage(phoneNumber, T.NOT_ELIGIBLE);
        trackEvent(phoneNumber, "eligibility_failed", {
            reason: result.reason || "not_found",
        });
        return;
    }

    // Check Gaso eligibility matrix (need age first)
    updateConversationState(phoneNumber, "COLLECT_AGE", {
        segment: "gaso",
        clientName: result.name,
        creditLine: result.credit,
        nse: result.nse,
    });

    await WhatsAppService.sendMessage(
        phoneNumber,
        T.ASK_AGE(result.name || "Cliente"),
    );
}

async function handleSendImages(
    phoneNumber: string,
    category: string,
    context: StateContext,
): Promise<void> {
    const segment = context.segment || "fnb";
    const creditLine = context.creditLine || 0;

    let products = CatalogService.getBySegment(segment).filter((p) =>
        p.category.toLowerCase().includes(category.toLowerCase()),
    );

    // Filter by available credit for both FNB and Gaso clients
    if (creditLine > 0) {
        products = products.filter((p) => p.price <= creditLine);
    }

    // Take top 3 products
    products = products.slice(0, 3);

    if (products.length === 0) {
        await WhatsAppService.sendMessage(phoneNumber, T.NO_STOCK);
        return;
    }

    for (const product of products) {
        const caption = `${product.name}\nPrecio: S/ ${product.price.toFixed(2)}${product.installments ? `\nCuotas: ${product.installments} meses` : ""}`;

        await WhatsAppService.sendImage(
            phoneNumber,
            product.image_main_path,
            caption,
        );
    }
}

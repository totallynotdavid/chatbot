import type { TransitionInput, StateOutput, Command } from "./types.ts";
import { extractDNI, extractAge } from "../validation/regex.ts";
import { sanitizeInput } from "../validation/input-sanitizer.ts";
import { checkGasoEligibility } from "../eligibility/gaso-logic.ts";
import * as T from "../templates/standard.ts";
import * as S from "../templates/sales.ts";

export function transition(input: TransitionInput): StateOutput {
    const message = sanitizeInput(input.message);
    const { currentState, context } = input;

    switch (currentState) {
        case "INIT":
            return handleInit(context);

        case "CONFIRM_CLIENT":
            return handleConfirmClient(message, context);

        case "COLLECT_DNI":
            return handleCollectDNI(message, context);

        case "WAITING_PROVIDER":
            return handleWaitingProvider(context);

        case "COLLECT_AGE":
            return handleCollectAge(message, context);

        case "OFFER_PRODUCTS":
            return handleOfferProducts(message, context);

        case "HANDLE_OBJECTION":
            return handleObjection(message, context);

        case "CLOSING":
            return handleClosing(context);

        case "ESCALATED":
            return handleEscalated(context);

        default:
            return {
                nextState: currentState,
                commands: [
                    { type: "SEND_MESSAGE", content: T.UNCLEAR_RESPONSE },
                ],
                updatedContext: {},
            };
    }
}

function handleInit(context: any): StateOutput {
    const commands: Command[] = [
        { type: "TRACK_EVENT", eventType: "session_start", metadata: {} },
    ];

    // Check if returning user had previous interest
    if (context.lastInterestCategory) {
        commands.push({
            type: "SEND_MESSAGE",
            content: T.GREETING_RETURNING(context.lastInterestCategory),
        });
    } else {
        commands.push({
            type: "SEND_MESSAGE",
            content: T.GREETING,
        });
    }

    return {
        nextState: "CONFIRM_CLIENT",
        commands,
        updatedContext: { sessionStartedAt: new Date().toISOString() },
    };
}

function handleConfirmClient(message: string, context: any): StateOutput {
    const lower = message.toLowerCase();

    // Positive responses
    if (
        /\b(s[ií]|claro|ok|dale|afirmativo|correcto|exacto|sep)\b/.test(lower)
    ) {
        return {
            nextState: "COLLECT_DNI",
            commands: [
                { type: "SEND_MESSAGE", content: T.CONFIRM_CLIENT_YES },
                {
                    type: "TRACK_EVENT",
                    eventType: "confirmed_calidda_client",
                    metadata: { response: message },
                },
            ],
            updatedContext: { isCaliddaClient: true },
        };
    }

    // Negative responses
    if (/\b(no|nada|negativo)\b/.test(lower)) {
        return {
            nextState: "CLOSING",
            commands: [
                { type: "SEND_MESSAGE", content: T.CONFIRM_CLIENT_NO },
                {
                    type: "TRACK_EVENT",
                    eventType: "not_calidda_client",
                    metadata: { response: message },
                },
            ],
            updatedContext: { isCaliddaClient: false },
        };
    }

    // Unclear
    return {
        nextState: "CONFIRM_CLIENT",
        commands: [
            {
                type: "SEND_MESSAGE",
                content: `Disculpa, no entendí. ¿Eres titular del servicio de gas natural de Calidda? (Responde Sí o No)`,
            },
        ],
        updatedContext: {},
    };
}

function handleCollectDNI(message: string, context: any): StateOutput {
    const dni = extractDNI(message);

    if (dni) {
        return {
            nextState: "WAITING_PROVIDER",
            commands: [
                { type: "SEND_MESSAGE", content: T.CHECKING_SYSTEM },
                { type: "CHECK_FNB", dni },
                {
                    type: "TRACK_EVENT",
                    eventType: "dni_collected",
                    metadata: { dni },
                },
            ],
            updatedContext: { dni },
        };
    }

    const lower = message.toLowerCase();
    
    // Check if user is expressing they can't provide DNI right now or will send it later
    const cantProvideNow = /\b(no\s+(lo\s+)?tengo|no\s+tengo\s+a\s+la\s+mano|voy\s+a\s+buscar|déjame\s+buscar|un\s+momento|espera|buscando|no\s+me\s+acuerdo|no\s+sé|no\s+se|no\s+lo\s+encuentro)\b/.test(lower);
    const willSendLater = /\b(te\s+(mando|envío|envio|escribo)|en\s+un\s+rato|más\s+tarde|mas\s+tarde|luego|después|despues|ahora\s+no|ahorita\s+no)\b/.test(lower);
    
    // If they say they'll send it later, just wait silently
    if (willSendLater) {
        return {
            nextState: "COLLECT_DNI",
            commands: [], // Don't send any message, just wait for them to send DNI
            updatedContext: {},
        };
    }
    
    // If they can't provide it now, respond once with waiting message
    if (cantProvideNow) {
        // Only send the waiting message if we haven't already
        if (!context.askedToWait) {
            return {
                nextState: "COLLECT_DNI",
                commands: [{ type: "SEND_MESSAGE", content: T.DNI_WAITING }],
                updatedContext: { askedToWait: true },
            };
        }
        // If we already asked them to wait, just stay silent
        return {
            nextState: "COLLECT_DNI",
            commands: [],
            updatedContext: {},
        };
    }
    
    // Check for pure acknowledgment/conversational messages that don't need a response
    const isAcknowledgment = /^(gracias|ok|vale|entendido|perfecto|bien|listo|ya|ahora|bueno|dale)[!.\s,]*$/i.test(message.trim());
    if (isAcknowledgment) {
        return {
            nextState: "COLLECT_DNI",
            commands: [], // Don't send any message, just wait
            updatedContext: {},
        };
    }
    
    // Check for completely unclear/off-topic responses
    const veryShort = message.trim().length <= 3;
    if (veryShort) {
        return {
            nextState: "COLLECT_DNI",
            commands: [], // Don't send any message for very short responses
            updatedContext: {},
        };
    }

    // Invalid DNI format
    return {
        nextState: "COLLECT_DNI",
        commands: [{ type: "SEND_MESSAGE", content: T.INVALID_DNI }],
        updatedContext: {},
    };
}

function handleWaitingProvider(context: any): StateOutput {
    // This state is transitioned by backend after provider check
    // If we somehow end up here with user input, just wait
    return {
        nextState: "WAITING_PROVIDER",
        commands: [],
        updatedContext: {},
    };
}

function handleCollectAge(message: string, context: any): StateOutput {
    const age = extractAge(message);

    if (!age) {
        return {
            nextState: "COLLECT_AGE",
            commands: [{ type: "SEND_MESSAGE", content: T.INVALID_AGE }],
            updatedContext: {},
        };
    }

    // Validate age against NSE matrix using gaso-logic
    if (
        context.segment === "gaso" &&
        context.nse &&
        context.creditLine !== undefined
    ) {
        const eligibility = checkGasoEligibility(
            age,
            context.nse,
            context.creditLine,
        );

        if (!eligibility.eligible) {
            // Age too low for NSE stratum
            const minAge = context.nse <= 2 ? 40 : context.nse === 3 ? 30 : 18;
            return {
                nextState: "CLOSING",
                commands: [
                    { type: "SEND_MESSAGE", content: T.AGE_TOO_LOW(minAge) },
                    {
                        type: "TRACK_EVENT",
                        eventType: "eligibility_failed",
                        metadata: {
                            reason: eligibility.reason,
                            age,
                            nse: context.nse,
                        },
                    },
                ],
                updatedContext: { age },
            };
        }

        // Age passed, apply NSE credit cap and store max installments
        const commands: Command[] = [
            {
                type: "TRACK_EVENT",
                eventType: "eligibility_passed",
                metadata: {
                    segment: "gaso",
                    age,
                    nse: context.nse,
                    rawCredit: context.creditLine,
                    cappedCredit: eligibility.maxCredit,
                },
            },
            {
                type: "SEND_MESSAGE",
                content: S.GASO_OFFER_KITCHEN_BUNDLE,
            },
        ];

        return {
            nextState: "OFFER_PRODUCTS",
            commands,
            updatedContext: {
                age,
                creditLine: eligibility.maxCredit, // Store NSE-capped credit
                maxInstallments: eligibility.maxInstallments,
            },
        };
    }

    // Fallback for non-gaso or missing data
    return {
        nextState: "OFFER_PRODUCTS",
        commands: [
            {
                type: "TRACK_EVENT",
                eventType: "eligibility_passed",
                metadata: { segment: context.segment, age },
            },
        ],
        updatedContext: { age },
    };
}

function handleOfferProducts(message: string, context: any): StateOutput {
    const lower = message.toLowerCase();

    // Check for rejection
    if (/\b(no|nada|no gracias|paso)\b/.test(lower)) {
        if (context.segment === "gaso") {
            return {
                nextState: "HANDLE_OBJECTION",
                commands: [
                    {
                        type: "SEND_MESSAGE",
                        content: S.KITCHEN_OBJECTION_RESPONSE,
                    },
                ],
                updatedContext: { objectionCount: 1 },
            };
        }
        return {
            nextState: "CLOSING",
            commands: [
                {
                    type: "SEND_MESSAGE",
                    content: `Entiendo. Si cambias de opinión, aquí estaré. ¡Gracias!`,
                },
            ],
            updatedContext: {},
        };
    }

    // Extract category interest
    const categoryMatch = lower.match(
        /\b(celular|smartphone|cocina|laptop|refrigerad|refri|tv|television|terma)\w*/,
    );

    if (categoryMatch) {
        let category = categoryMatch[0];
        if (category.startsWith("celular") || category.startsWith("smartphone"))
            category = "celulares";
        else if (category.startsWith("cocina")) category = "cocinas";
        else if (category.startsWith("laptop")) category = "laptops";
        else if (category.startsWith("refri")) category = "refrigeradoras";
        else if (category.startsWith("tv") || category.startsWith("television"))
            category = "televisores";
        else if (category.startsWith("terma")) category = "termas";

        return {
            nextState: "CLOSING",
            commands: [
                { type: "SEND_MESSAGE", content: S.OFFER_PRODUCTS(category) },
                { type: "SEND_IMAGES", productIds: [], category },
                {
                    type: "TRACK_EVENT",
                    eventType: "products_offered",
                    metadata: { category, segment: context.segment },
                },
                {
                    type: "SEND_MESSAGE",
                    content: S.ASK_FOR_SPECS,
                },
            ],
            updatedContext: {
                offeredCategory: category,
                lastInterestCategory: category,
            },
        };
    }

    // Unclear request
    return {
        nextState: "OFFER_PRODUCTS",
        commands: [{ type: "SEND_MESSAGE", content: S.ASK_PRODUCT_INTEREST }],
        updatedContext: {},
    };
}

function handleObjection(message: string, context: any): StateOutput {
    const objectionCount = context.objectionCount || 0;

    if (objectionCount >= 2) {
        // Escalate after second objection (third rejection total)
        return {
            nextState: "ESCALATED",
            commands: [
                { type: "SEND_MESSAGE", content: T.ESCALATED_TO_HUMAN },
                {
                    type: "ESCALATE",
                    reason: "Multiple objections to mandatory kitchen bundle",
                },
                {
                    type: "NOTIFY_TEAM",
                    channel: "agent",
                    message: `Cliente ${context.phoneNumber} rechazó bundle de cocina múltiples veces. Requiere atención.`,
                },
            ],
            updatedContext: {},
        };
    }

    const lower = message.toLowerCase();

    // Still rejecting
    if (/\b(no|nada|no quiero)\b/.test(lower)) {
        if (objectionCount === 1) {
            // Offer therma as last resort after first objection
            return {
                nextState: "HANDLE_OBJECTION",
                commands: [
                    { type: "SEND_MESSAGE", content: S.THERMA_ALTERNATIVE },
                ],
                updatedContext: { objectionCount: 2 },
            };
        }

        // This shouldn't normally be reached, but handles edge case
        return {
            nextState: "HANDLE_OBJECTION",
            commands: [
                { type: "SEND_MESSAGE", content: S.KITCHEN_OBJECTION_RESPONSE },
            ],
            updatedContext: { objectionCount: objectionCount + 1 },
        };
    }

    // Accepted
    if (/\b(s[ií]|ok|claro|dale|bueno)\b/.test(lower)) {
        return handleOfferProducts(message, context);
    }

    return {
        nextState: "HANDLE_OBJECTION",
        commands: [{ type: "SEND_MESSAGE", content: T.ASK_CLARIFICATION }],
        updatedContext: {},
    };
}

function handleClosing(context: any): StateOutput {
    return {
        nextState: "CLOSING",
        commands: [],
        updatedContext: {},
    };
}

function handleEscalated(context: any): StateOutput {
    return {
        nextState: "ESCALATED",
        commands: [],
        updatedContext: {},
    };
}

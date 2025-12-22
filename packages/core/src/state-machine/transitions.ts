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

function handleConfirmClient(message: string, _context: any): StateOutput {
    const lower = message.toLowerCase().trim();

    // Check if user volunteered DNI early (e.g., "Sí, mi DNI es 72345678")
    const earlyDNI = extractDNI(message);
    
    // NEGATIVE CHECK FIRST - specific "no" + verb patterns
    if (
        /no\s+(tengo|soy)/.test(lower) || // "no tengo" or "no soy"
        /^no(\s|,|!|$)/.test(lower) || // just "no"
        /\b(nada|negativo)(\s|,|!|$)/.test(lower) // "nada" or "negativo"
    ) {
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

    // POSITIVE CHECK - contains clear affirmations
    if (
        /\bs[ií](\s|,|!|\?|$)/.test(lower) || // "sí" or "si" as a word
        /\b(claro|ok|vale|dale|afirmativo|correcto|sep|bueno)(\s|,|!|\?|$)/.test(lower) || // common affirmations
        /(soy|tengo)\s+(cliente|c[ií]lidda|gas)/.test(lower) // "soy cliente" or "tengo cálidda"
    ) {
        // If they already provided DNI, skip straight to provider check
        if (earlyDNI) {
            return {
                nextState: "WAITING_PROVIDER",
                commands: [
                    { type: "SEND_MESSAGE", content: T.CHECKING_SYSTEM },
                    { type: "CHECK_FNB", dni: earlyDNI },
                    {
                        type: "TRACK_EVENT",
                        eventType: "confirmed_calidda_client",
                        metadata: { response: message },
                    },
                ],
                updatedContext: { isCaliddaClient: true, dni: earlyDNI },
            };
        }
        
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

    // Unclear - user didn't clearly say yes or no
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
    // Use explicit Unicode for accented characters to ensure matching works
    const cantProvideNow = /(no\s+(lo\s+)?tengo|no\s+tengo\s+a\s+la\s+mano|voy\s+a\s+busca|d[e\u00e9]jame\s+busca|un\s+momento|espera|buscando|no\s+me\s+acuerdo|no\s+s[e\u00e9]|no\s+lo\s+encuentro)/.test(lower);
    const willSendLater = /(te\s+(mando|env[i\u00ed]o|escribo)|en\s+un\s+rato|m[a\u00e1]s\s+tarde|luego|despu[e\u00e9]s|ahora\s+no|ahorita\s+no)/.test(lower);
    
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

    // Check for progress updates ("ya casi", "casi listo", etc.) - stay silent
    const isProgressUpdate = /(ya\s+casi|casi|esperame|un\s+segundo)/.test(lower);
    if (isProgressUpdate) {
        return {
            nextState: "COLLECT_DNI",
            commands: [], // Don't send any message, they're working on it
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
    // If user is still messaging while waiting, they're getting impatient
    // Check if they've been waiting too long or sent multiple messages
    const messageCount = (context.waitingMessageCount || 0) + 1;
    
    // After 3 frustrated attempts to communicate, escalate
    if (messageCount > 2) {
        return {
            nextState: "ESCALATED",
            commands: [
                { 
                    type: "SEND_MESSAGE", 
                    content: `Veo que sigues esperando. Un asesor se comunicará contigo en unos momentos para continuar. ¡Gracias por tu paciencia!` 
                },
                { 
                    type: "ESCALATE", 
                    reason: "provider_check_timeout_multiple_messages" 
                },
            ],
            updatedContext: { waitingMessageCount: messageCount },
        };
    }
    
    // First or second message - acknowledge they're still here
    if (messageCount === 1) {
        return {
            nextState: "WAITING_PROVIDER",
            commands: [
                { 
                    type: "SEND_MESSAGE", 
                    content: `Estoy consultando el sistema. Un momento por favor... ⏳` 
                },
            ],
            updatedContext: { waitingMessageCount: messageCount },
        };
    }
    
    // Second message - promise quick resolution
    return {
        nextState: "WAITING_PROVIDER",
        commands: [
            { 
                type: "SEND_MESSAGE", 
                content: `Casi listo, solo un momento más... 🔄` 
            },
        ],
        updatedContext: { waitingMessageCount: messageCount },
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

    // Priority 1: Check if backend detected a question via LLM
    if (context.llmDetectedQuestion) {
        // If LLM says requires human (complex financial question)
        if (context.llmRequiresHuman) {
            return {
                nextState: "ESCALATED",
                commands: [
                    {
                        type: "SEND_MESSAGE",
                        content: "Para darte información precisa sobre eso, te conectaré con un asesor.",
                    },
                    {
                        type: "ESCALATE",
                        reason: "complex_question_requires_human",
                    },
                    {
                        type: "NOTIFY_TEAM",
                        channel: "agent",
                        message: `Cliente ${context.phoneNumber} pregunta sobre detalles financieros`,
                    },
                ],
                updatedContext: {},
            };
        }

        // LLM can answer - send LLM response + continue conversation
        return {
            nextState: "OFFER_PRODUCTS",
            commands: [
                {
                    type: "SEND_MESSAGE",
                    content: context.llmGeneratedAnswer || "Déjame explicarte...",
                },
                {
                    type: "SEND_MESSAGE",
                    content: "¿Qué producto te interesa? Tenemos celulares, cocinas, laptops, refrigeradoras, TVs y termas.",
                },
            ],
            updatedContext: {},
        };
    }

    // Check for purchase confirmation (customer wants to buy)
    // Only trigger if they've already been shown products (offeredCategory exists)
    if (context.offeredCategory && /\b(s[ií]|me lo llevo|lo quiero|comprarlo|comprar|lo compro|perfecto|dale)\b/.test(lower)) {
        return {
            nextState: "CLOSING",
            commands: [
                {
                    type: "SEND_MESSAGE",
                    content: "¡Excelente! Un asesor se comunicará contigo pronto para coordinar todo. 📞",
                },
                {
                    type: "NOTIFY_TEAM",
                    channel: "sales",
                    message: `Cliente ${context.phoneNumber} confirmó interés de compra en ${context.offeredCategory || 'productos'}`,
                },
                {
                    type: "TRACK_EVENT",
                    eventType: "purchase_intent_confirmed",
                    metadata: { category: context.offeredCategory, segment: context.segment },
                },
            ],
            updatedContext: { purchaseConfirmed: true },
        };
    }

    // Check for price objections BEFORE checking for rejection
    // These contain 'no' but are not rejections
    if (/(caro|costoso|precio|plata|dinero|pagar)/.test(lower)) {
        return {
            nextState: "OFFER_PRODUCTS",
            commands: [
                {
                    type: "SEND_MESSAGE",
                    content: "Entiendo. Lo bueno es que puedes pagarlo con financiamiento en cuotas mensuales que salen directo en tu recibo de Calidda. ¿Qué producto te llama la atención?",
                },
            ],
            updatedContext: {},
        };
    }

    // Check for uncertainty/confusion (not outright rejection)
    const isUncertain = /(no\s+estoy\s+seguro|no\s+s[eé]|nose|mmm|ehh|tal\s+vez)/.test(lower);
    if (isUncertain) {
        return {
            nextState: "OFFER_PRODUCTS",
            commands: [
                {
                    type: "SEND_MESSAGE",
                    content: S.ASK_PRODUCT_INTEREST,
                },
            ],
            updatedContext: {},
        };
    }

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
                    content: `Entiendo, sin problema. Si más adelante cambias de opinión, aquí estaré.`,
                },
            ],
            updatedContext: {},
        };
    }

    // Priority 2: Use LLM-extracted category if available (handles brands automatically)
    if (context.llmExtractedCategory) {
        return {
            nextState: "OFFER_PRODUCTS",
            commands: [
                {
                    type: "SEND_IMAGES",
                    category: context.llmExtractedCategory,
                    productIds: [],
                },
                {
                    type: "TRACK_EVENT",
                    eventType: "products_offered",
                    metadata: { 
                        category: context.llmExtractedCategory, 
                        segment: context.segment,
                        extractionMethod: "llm"
                    },
                },
            ],
            updatedContext: { offeredCategory: context.llmExtractedCategory },
        };
    }

    // Priority 3: Fallback to regex category extraction
    const categoryMatch = lower.match(
        /\b(celular|smartphone|iphone|redmi|samsung|xiaomi|cocina|laptop|notebook|computadora|refrigerad|refri|heladera|televi|tv|television|pantalla|terma|calentador|modelo|opcion)\w*/,
    );

    if (categoryMatch) {
        let category = categoryMatch[0];
        
        // Normalize brand names to category
        if (category.startsWith("iphone") || category.startsWith("redmi") || 
            category.startsWith("samsung") || category.startsWith("xiaomi") ||
            category.startsWith("celular") || 
            category.startsWith("smartphone"))
            category = "celulares";
        else if (category.startsWith("cocina")) 
            category = "cocinas";
        else if (category.startsWith("laptop") || category.startsWith("notebook") ||
                 category.startsWith("computadora"))
            category = "laptops";
        else if (category.startsWith("refri") || category.startsWith("heladera"))
            category = "refrigeradoras";
        else if (category.startsWith("tv") || category.startsWith("televi") || category.startsWith("television") ||
                 category.startsWith("pantalla"))
            category = "televisores";
        else if (category.startsWith("terma") || category.startsWith("calentador"))
            category = "termas";
        else if (category.startsWith("modelo") || category.startsWith("opcion"))
            category = "all"; // Show all available products

        return {
            nextState: "OFFER_PRODUCTS", // Stay in this state, awaiting purchase confirmation
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
                    content: "¿Te gustaría llevarte alguno de estos productos?",
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

    // Check if backend detected a question via LLM
    if (context.llmDetectedQuestion) {
        // If requires human, escalate; otherwise answer and continue
        if (context.llmRequiresHuman) {
            return {
                nextState: "ESCALATED",
                commands: [
                    {
                        type: "SEND_MESSAGE",
                        content: "Te conecto con un asesor para que te ayude con eso.",
                    },
                    {
                        type: "ESCALATE",
                        reason: "customer_question_during_objection",
                    },
                    {
                        type: "NOTIFY_TEAM",
                        channel: "agent",
                        message: `Cliente ${context.phoneNumber} tiene dudas durante objeción`,
                    },
                ],
                updatedContext: {},
            };
        }

        // Answer question and continue handling objection
        return {
            nextState: "HANDLE_OBJECTION",
            commands: [
                {
                    type: "SEND_MESSAGE",
                    content: context.llmGeneratedAnswer || "Déjame explicarte...",
                },
                {
                    type: "SEND_MESSAGE",
                    content: "¿Te gustaría ver alguna otra opción?",
                },
            ],
            updatedContext: {},
        };
    }

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

function handleClosing(_context: any): StateOutput {
    // Customer has confirmed purchase - terminal state, team has been notified
    return {
        nextState: "CLOSING",
        commands: [],
        updatedContext: {},
    };
}

function handleEscalated(_context: any): StateOutput {
    return {
        nextState: "ESCALATED",
        commands: [],
        updatedContext: {},
    };
}

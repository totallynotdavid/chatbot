import type { TransitionInput, StateOutput, Command } from "./types.ts";
import { extractDNI, extractAge } from "../validation/regex.ts";
import { sanitizeInput } from "../validation/input-sanitizer.ts";
import { formatFirstName } from "../validation/format-name.ts";
import { checkGasoEligibility } from "../eligibility/gaso-logic.ts";
import * as T from "../templates/standard.ts";
import * as S from "../templates/sales.ts";
import {
  selectVariant,
  selectVariantWithContext,
} from "../messaging/variation-selector.ts";
import {
  detectFrustration,
  detectNeedsPatience,
  isAcknowledgment,
} from "../messaging/context-analyzer.ts";
import { detectTone } from "../messaging/tone-detector.ts";

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

    default: {
      const { message: unclearMsg, updatedContext: unclearCtx } = selectVariant(
        T.UNCLEAR_RESPONSE,
        "UNCLEAR_RESPONSE",
        context,
      );
      return {
        nextState: currentState,
        commands: [{ type: "SEND_MESSAGE", content: unclearMsg }],
        updatedContext: unclearCtx,
      };
    }
  }
}

function handleInit(context: any): StateOutput {
  const commands: Command[] = [
    { type: "TRACK_EVENT", eventType: "session_start", metadata: {} },
  ];

  let variantUpdate = {};

  // Check if returning user had previous interest
  if (context.lastInterestCategory) {
    const greetingVariants = T.GREETING_RETURNING(context.lastInterestCategory);
    const { message, updatedContext } = selectVariant(
      greetingVariants,
      "GREETING_RETURNING",
      context,
    );
    commands.push({
      type: "SEND_MESSAGE",
      content: message,
    });
    variantUpdate = updatedContext;
  } else {
    const { message, updatedContext } = selectVariant(
      T.GREETING,
      "GREETING",
      context,
    );
    commands.push({
      type: "SEND_MESSAGE",
      content: message,
    });
    variantUpdate = updatedContext;
  }

  return {
    nextState: "CONFIRM_CLIENT",
    commands,
    updatedContext: {
      sessionStartedAt: new Date().toISOString(),
      ...variantUpdate,
    },
  };
}

function handleConfirmClient(message: string, context: any): StateOutput {
  const lower = message.toLowerCase().trim();

  // Check if user volunteered DNI early (e.g., "Sí, mi DNI es 72345678")
  const earlyDNI = extractDNI(message);

  // NEGATIVE CHECK FIRST - specific "no" + verb patterns
  if (
    /no\s+(tengo|soy)/.test(lower) || // "no tengo" or "no soy"
    /^no(\s|,|!|$)/.test(lower) || // just "no"
    /\b(nada|negativo)(\s|,|!|$)/.test(lower) // "nada" or "negativo"
  ) {
    const { message: noMsg, updatedContext: variantCtx } = selectVariant(
      T.CONFIRM_CLIENT_NO,
      "CONFIRM_CLIENT_NO",
      context,
    );
    return {
      nextState: "CLOSING",
      commands: [
        { type: "SEND_MESSAGE", content: noMsg },
        {
          type: "TRACK_EVENT",
          eventType: "not_calidda_client",
          metadata: { response: message },
        },
      ],
      updatedContext: { isCaliddaClient: false, ...variantCtx },
    };
  }

  // POSITIVE CHECK - contains clear affirmations
  if (
    /\bs[ií]+(\s|,|!|\?|$)/.test(lower) || // "sí", "si", "siii", "síííí" (enthusiastic variations)
    /\b(claro|ok|vale|dale|afirmativo|correcto|sep|bueno)(\s|,|!|\?|$)/.test(
      lower,
    ) || // common affirmations
    /(soy|tengo)\s+(cliente|c[ií]lidda|gas)/.test(lower) // "soy cliente" or "tengo cálidda"
  ) {
    // SMART RESUME: If we already have DNI and credit info from a previous session
    if (context.dni && context.segment && context.creditLine !== undefined) {
      const firstName = context.clientName
        ? formatFirstName(context.clientName)
        : "";
      const resumeMsg = firstName
        ? `¡Excelente ${firstName}! Sigamos viendo opciones para ti.`
        : `¡Excelente! Sigamos viendo opciones para ti.`;

      // If it's FNB, we can skip straight to offering products
      if (context.segment === "fnb") {
        return {
          nextState: "OFFER_PRODUCTS",
          commands: [
            { type: "SEND_MESSAGE", content: resumeMsg },
            {
              type: "SEND_MESSAGE",
              content: `Anteriormente buscabas ${context.lastInterestCategory || "productos"}. ¿Quieres ver opciones o prefieres otra cosa?`,
            },
          ],
          updatedContext: { isCaliddaClient: true },
        };
      }

      // If it's Gaso, we might still need age if it wasn't preserved,
      // but for now let's at least skip DNI.
      return {
        nextState: "COLLECT_AGE",
        commands: [{ type: "SEND_MESSAGE", content: resumeMsg }],
        updatedContext: { isCaliddaClient: true },
      };
    }

    // If they already provided DNI in THIS message, skip straight to provider check
    if (earlyDNI) {
      return {
        nextState: "WAITING_PROVIDER",
        commands: [
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

    const { message: yesMsg, updatedContext: variantCtx } = selectVariant(
      T.CONFIRM_CLIENT_YES,
      "CONFIRM_CLIENT_YES",
      context,
    );
    return {
      nextState: "COLLECT_DNI",
      commands: [
        { type: "SEND_MESSAGE", content: yesMsg },
        {
          type: "TRACK_EVENT",
          eventType: "confirmed_calidda_client",
          metadata: { response: message },
        },
      ],
      updatedContext: { isCaliddaClient: true, ...variantCtx },
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

  // Increment message count in this state
  const messageCountInState = (context.messageCountInState || 0) + 1;

  if (dni) {
    // Detect tone for future interactions
    const userTone = detectTone(message);

    // Don't send "checking" message immediately - let provider respond fast if it can
    // Only send patience messages if user messages during wait (handled in WAITING_PROVIDER)
    return {
      nextState: "WAITING_PROVIDER",
      commands: [
        { type: "CHECK_FNB", dni },
        {
          type: "TRACK_EVENT",
          eventType: "dni_collected",
          metadata: { dni },
        },
      ],
      updatedContext: {
        dni,
        userTone,
        messageCountInState: 0, // Reset for next state
        lastBotMessageTime: new Date().toISOString(),
      },
    };
  }

  const lower = message.toLowerCase();

  // Detect if user needs patience (explicit check for flexibility)
  const needsPatience = detectNeedsPatience(message);

  // Check if user is expressing they can't provide DNI right now or will send it later
  const cantProvideNow =
    /(no\s+(lo\s+)?tengo|no\s+tengo\s+a\s+la\s+mano|voy\s+a\s+busca|d[e\u00e9]jame\s+busca|un\s+momento|espera|buscando|no\s+me\s+acuerdo|no\s+s[e\u00e9]|no\s+lo\s+encuentro)/.test(
      lower,
    );
  const willSendLater =
    /(te\s+(mando|env[i\u00ed]o|escribo)|en\s+un\s+rato|m[a\u00e1]s\s+tarde|luego|despu[e\u00e9]s|ahora\s+no|ahorita\s+no)/.test(
      lower,
    );

  // If they say they'll send it later, just wait silently
  if (willSendLater) {
    return {
      nextState: "COLLECT_DNI",
      commands: [], // Don't send any message, just wait for them to send DNI
      updatedContext: { messageCountInState },
    };
  }

  // If they can't provide it now, respond once with waiting message
  if (cantProvideNow || needsPatience) {
    // Only send the waiting message if we haven't already
    if (!context.askedToWait) {
      const { message: waitMsg, updatedContext: variantCtx } =
        selectVariantWithContext(T.DNI_WAITING, "DNI_WAITING", context, {
          needsPatience: true,
        });
      return {
        nextState: "COLLECT_DNI",
        commands: [{ type: "SEND_MESSAGE", content: waitMsg }],
        updatedContext: {
          askedToWait: true,
          messageCountInState,
          lastBotMessageTime: new Date().toISOString(),
          ...variantCtx,
        },
      };
    }
    // If we already asked them to wait, just stay silent
    return {
      nextState: "COLLECT_DNI",
      commands: [],
      updatedContext: { messageCountInState },
    };
  }

  // Check for pure acknowledgment/conversational messages that don't need a response
  const isAck = isAcknowledgment(message);
  if (isAck) {
    return {
      nextState: "COLLECT_DNI",
      commands: [], // Don't send any message, just wait
      updatedContext: { messageCountInState },
    };
  }

  // Check for progress updates ("ya casi", "casi listo", etc.) - stay silent
  const isProgressUpdate = /(ya\s+casi|casi|esperame|un\s+segundo)/.test(lower);
  if (isProgressUpdate) {
    return {
      nextState: "COLLECT_DNI",
      commands: [], // Don't send any message, they're working on it
      updatedContext: { messageCountInState },
    };
  }

  // Check for completely unclear/off-topic responses
  const veryShort = message.trim().length <= 3;
  if (veryShort) {
    return {
      nextState: "COLLECT_DNI",
      commands: [], // Don't send any message for very short responses
      updatedContext: { messageCountInState },
    };
  }

  // Invalid DNI format - use patient variant if multiple attempts
  const { message: invalidMsg, updatedContext: variantCtx } = selectVariant(
    T.INVALID_DNI,
    "INVALID_DNI",
    context,
  );
  return {
    nextState: "COLLECT_DNI",
    commands: [{ type: "SEND_MESSAGE", content: invalidMsg }],
    updatedContext: variantCtx,
  };
}

function handleWaitingProvider(context: any): StateOutput {
  // If user is still messaging while waiting, they're getting impatient
  // Check if they've been waiting too long or sent multiple messages
  const messageCount = (context.waitingMessageCount || 0) + 1;

  // After 3 frustrated attempts to communicate, escalate silently
  if (messageCount > 2) {
    const { message: handoffMsg, updatedContext: variantCtx } =
      selectVariantWithContext(
        T.HANDOFF_TO_HUMAN,
        "HANDOFF_TO_HUMAN",
        context,
        { frustrated: true },
      );
    return {
      nextState: "ESCALATED",
      commands: [
        {
          type: "SEND_MESSAGE",
          content: handoffMsg,
        },
        {
          type: "ESCALATE",
          reason: "provider_check_timeout_multiple_messages",
        },
      ],
      updatedContext: {
        waitingMessageCount: messageCount,
        isFrustrated: true,
        lastBotMessageTime: new Date().toISOString(),
        ...variantCtx,
      },
    };
  }

  // First message - acknowledge they're still here with categorized patience variant
  if (messageCount === 1) {
    const { message: checkingMsg, updatedContext: variantCtx } =
      selectVariantWithContext(T.CHECKING_SYSTEM, "CHECKING_SYSTEM", context, {
        needsPatience: true,
      });
    return {
      nextState: "WAITING_PROVIDER",
      commands: [
        {
          type: "SEND_MESSAGE",
          content: checkingMsg,
        },
      ],
      updatedContext: {
        waitingMessageCount: messageCount,
        lastBotMessageTime: new Date().toISOString(),
        ...variantCtx,
      },
    };
  }

  // Second message - empathetic variant recognizing frustration
  const { message: empathyMsg, updatedContext: variantCtx } =
    selectVariantWithContext(T.CHECKING_SYSTEM, "CHECKING_SYSTEM", context, {
      frustrated: true,
    });
  return {
    nextState: "WAITING_PROVIDER",
    commands: [
      {
        type: "SEND_MESSAGE",
        content: empathyMsg,
      },
    ],
    updatedContext: {
      waitingMessageCount: messageCount,
      lastBotMessageTime: new Date().toISOString(),
      ...variantCtx,
    },
  };
}

function handleCollectAge(message: string, context: any): StateOutput {
  const age = extractAge(message);

  if (!age) {
    const { message: invalidMsg, updatedContext: variantCtx } = selectVariant(
      T.INVALID_AGE,
      "INVALID_AGE",
      context,
    );
    return {
      nextState: "COLLECT_AGE",
      commands: [{ type: "SEND_MESSAGE", content: invalidMsg }],
      updatedContext: variantCtx,
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
      const ageTooLowVariants = T.AGE_TOO_LOW(minAge);
      const { message: ageMsg, updatedContext: variantCtx } = selectVariant(
        ageTooLowVariants,
        "AGE_TOO_LOW",
        context,
      );
      return {
        nextState: "CLOSING",
        commands: [
          { type: "SEND_MESSAGE", content: ageMsg },
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
        updatedContext: { age, ...variantCtx },
      };
    }

    // Age passed, apply NSE credit cap and store max installments
    const gasoOfferVariants = S.GASO_OFFER_KITCHEN_BUNDLE;
    const { message: offerMsg, updatedContext: variantCtx } = selectVariant(
      gasoOfferVariants,
      "GASO_OFFER_KITCHEN_BUNDLE",
      context,
    );
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
        content: offerMsg,
      },
    ];

    return {
      nextState: "OFFER_PRODUCTS",
      commands,
      updatedContext: {
        age,
        creditLine: eligibility.maxCredit, // Store NSE-capped credit
        maxInstallments: eligibility.maxInstallments,
        ...variantCtx,
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

  // Priority 1: Product category extraction (matcher or LLM already ran in backend)
  if (context.extractedCategory) {
    return {
      nextState: "OFFER_PRODUCTS",
      commands: [
        {
          type: "SEND_IMAGES",
          category: context.extractedCategory,
          productIds: [],
        },
        {
          type: "TRACK_EVENT",
          eventType: "products_offered",
          metadata: {
            category: context.extractedCategory,
            segment: context.segment,
            extractionMethod: context.usedLLM ? "llm" : "matcher",
          },
        },
      ],
      updatedContext: {
        offeredCategory: context.extractedCategory,
        lastInterestCategory: context.extractedCategory,
      },
    };
  }

  // Priority 2: Check if backend detected a question via LLM
  if (context.llmDetectedQuestion) {
    // If LLM says requires human (complex financial question)
    if (context.llmRequiresHuman) {
      return {
        nextState: "ESCALATED",
        commands: [
          {
            type: "SEND_MESSAGE",
            content:
              "Para darte información precisa sobre eso, te conectaré con un asesor.",
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
          content:
            "¿Qué producto te interesa? Tenemos celulares, cocinas, refrigeradoras, TVs y termas.",
        },
      ],
      updatedContext: {},
    };
  }

  // Check for purchase confirmation (customer wants to buy)
  // Only trigger if they've already been shown products (offeredCategory exists)
  const isInterestPhrase =
    /\b(me interesa|interesad|lo quiero|lo compro|me lo llevo|comprar|comprarlo)\b/.test(
      lower,
    );
  const isOrdinalSelection = /\b(primer|segund|tercer|cuart|quint)\w*/.test(
    lower,
  );
  const isAffirmative = /\b(s[ií]|ok|dale|perfecto|vale|bueno)\b/.test(lower);

  if (
    context.offeredCategory &&
    (isInterestPhrase || isOrdinalSelection || isAffirmative)
  ) {
    const { message: confirmMsg, updatedContext: variantCtx } = selectVariant(
      S.CONFIRM_PURCHASE,
      "CONFIRM_PURCHASE",
      context,
    );
    return {
      nextState: "CLOSING",
      commands: [
        {
          type: "SEND_MESSAGE",
          content: confirmMsg,
        },
        {
          type: "NOTIFY_TEAM",
          channel: "sales",
          message: `Cliente ${context.phoneNumber} confirmó interés de compra en ${context.offeredCategory || "productos"} (Mensaje: "${message}")`,
        },
        {
          type: "TRACK_EVENT",
          eventType: "purchase_intent_confirmed",
          metadata: {
            category: context.offeredCategory,
            segment: context.segment,
            selectionType: isOrdinalSelection ? "ordinal" : "phrase",
          },
        },
      ],
      updatedContext: { purchaseConfirmed: true, ...variantCtx },
    };
  }

  // Check for price objections BEFORE checking for rejection
  // These contain 'no' but are not rejections
  if (/(caro|costoso|precio|plata|dinero|pagar)/.test(lower)) {
    // Detect if user is frustrated about pricing
    const frustrated = detectFrustration(message);

    const { message: priceMsg, updatedContext: variantCtx } =
      selectVariantWithContext(S.PRICE_CONCERN, "PRICE_CONCERN", context, {
        frustrated,
      });
    return {
      nextState: "OFFER_PRODUCTS",
      commands: [
        {
          type: "SEND_MESSAGE",
          content: priceMsg,
        },
      ],
      updatedContext: {
        isFrustrated: frustrated,
        lastBotMessageTime: new Date().toISOString(),
        ...variantCtx,
      },
    };
  }

  // Check for uncertainty/confusion (not outright rejection)
  const isUncertain =
    /(no\s+estoy\s+seguro|no\s+s[eé]|nose|mmm|ehh|tal\s+vez)/.test(lower);
  if (isUncertain) {
    let responseMsg = "";
    if (context.offeredCategory) {
      responseMsg =
        "¿Te gustaría llevarte alguno de los que te mostré o prefieres ver otra cosa?";
    } else {
      const { message: interestMsg } = selectVariant(
        S.ASK_PRODUCT_INTEREST,
        "ASK_PRODUCT_INTEREST",
        context,
      );
      responseMsg = interestMsg;
    }

    return {
      nextState: "OFFER_PRODUCTS",
      commands: [
        {
          type: "SEND_MESSAGE",
          content: responseMsg,
        },
      ],
      updatedContext: {},
    };
  }

  // Check for rejection
  if (/\b(no|nada|no gracias|paso)\b/.test(lower)) {
    if (context.segment === "gaso") {
      const { message: objectionMsg, updatedContext: variantCtx } =
        selectVariant(
          S.KITCHEN_OBJECTION_RESPONSE,
          "KITCHEN_OBJECTION_RESPONSE",
          context,
        );
      return {
        nextState: "HANDLE_OBJECTION",
        commands: [
          {
            type: "SEND_MESSAGE",
            content: objectionMsg,
          },
        ],
        updatedContext: { objectionCount: 1, ...variantCtx },
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

  // Unclear request
  const { message: interestMsg, updatedContext: variantCtx } = selectVariant(
    S.ASK_PRODUCT_INTEREST,
    "ASK_PRODUCT_INTEREST",
    context,
  );
  return {
    nextState: "OFFER_PRODUCTS",
    commands: [{ type: "SEND_MESSAGE", content: interestMsg }],
    updatedContext: variantCtx,
  };
}

function handleObjection(message: string, context: any): StateOutput {
  const objectionCount = context.objectionCount || 0;

  // Check if backend detected a question via LLM
  if (context.llmDetectedQuestion) {
    // If requires human, escalate; otherwise answer and continue
    if (context.llmRequiresHuman) {
      const { message: handoffMsg, updatedContext: variantCtx } =
        selectVariantWithContext(
          T.HANDOFF_TO_HUMAN,
          "HANDOFF_TO_HUMAN",
          context,
          { frustrated: objectionCount > 1 },
        );
      return {
        nextState: "ESCALATED",
        commands: [
          {
            type: "SEND_MESSAGE",
            content: handoffMsg,
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
        updatedContext: variantCtx,
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
    // Escalate after second objection (third rejection total) - silent escalation
    const { message: handoffMsg, updatedContext: variantCtx } =
      selectVariantWithContext(
        T.HANDOFF_TO_HUMAN,
        "HANDOFF_TO_HUMAN",
        context,
        { frustrated: true },
      );
    return {
      nextState: "ESCALATED",
      commands: [
        { type: "SEND_MESSAGE", content: handoffMsg },
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
      updatedContext: variantCtx,
    };
  }

  const lower = message.toLowerCase();

  // Still rejecting
  if (/\b(no|nada|no quiero)\b/.test(lower)) {
    if (objectionCount === 1) {
      // Offer therma as last resort after first objection
      const { message: thermaMsg, updatedContext: variantCtx } = selectVariant(
        S.THERMA_ALTERNATIVE,
        "THERMA_ALTERNATIVE",
        context,
      );
      return {
        nextState: "HANDLE_OBJECTION",
        commands: [{ type: "SEND_MESSAGE", content: thermaMsg }],
        updatedContext: { objectionCount: 2, ...variantCtx },
      };
    }

    // This shouldn't normally be reached, but handles edge case
    const { message: objectionMsg, updatedContext: variantCtx } = selectVariant(
      S.KITCHEN_OBJECTION_RESPONSE,
      "KITCHEN_OBJECTION_RESPONSE",
      context,
    );
    return {
      nextState: "HANDLE_OBJECTION",
      commands: [{ type: "SEND_MESSAGE", content: objectionMsg }],
      updatedContext: { objectionCount: objectionCount + 1, ...variantCtx },
    };
  }

  // Accepted
  if (/\b(s[ií]|ok|claro|dale|bueno)\b/.test(lower)) {
    return handleOfferProducts(message, context);
  }

  const { message: clarifyMsg, updatedContext: variantCtx } = selectVariant(
    T.ASK_CLARIFICATION,
    "ASK_CLARIFICATION",
    context,
  );
  return {
    nextState: "HANDLE_OBJECTION",
    commands: [{ type: "SEND_MESSAGE", content: clarifyMsg }],
    updatedContext: variantCtx,
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

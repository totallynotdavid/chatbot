/**
 * Context Analyzer - Detects conversation signals for intelligent response selection
 * 
 * Tracks frustration, repeat requests, waiting time to select empathetic variants
 * when appropriate.
 */

export interface ConversationSignals {
    frustrated?: boolean;           // User showing frustration
    needsPatience?: boolean;        // User needs more time/patience
    repeatRequest?: boolean;        // Asking same thing again
    tone?: "formal" | "casual" | "neutral";
    repeatRequestCount?: number;    // How many times asked same thing
    waitingTime?: number;           // Seconds since last bot message
}

/**
 * Detect if user message shows frustration
 * 
 * Signals:
 * - ALL CAPS (>50% of message)
 * - Urgency words (YA, AHORA, RÁPIDO, URGENTE)
 * - Multiple punctuation (!!!, ???)
 * - Negative sentiment (molesto, cansado, harto)
 */
export function detectFrustration(message: string): boolean {
    if (!message || message.length < 3) return false;

    const normalized = message.trim();
    const letters = normalized.replace(/[^a-záéíóúñA-ZÁÉÍÓÚÑ]/g, "");
    
    // Check for excessive CAPS (>50% of letters)
    if (letters.length > 5) {
        const uppercaseCount = (letters.match(/[A-ZÁÉÍÓÚÑ]/g) || []).length;
        const capsRatio = uppercaseCount / letters.length;
        if (capsRatio > 0.5) return true;
    }

    const lowerMessage = normalized.toLowerCase();

    // Urgency words
    const urgencyPatterns = [
        /\bya\b/,
        /\bahora\b/,
        /\brápido\b/,
        /\brapido\b/,
        /\burgente\b/,
        /\binmediatamente\b/,
        /\bapúrate\b/,
        /\bapurate\b/,
    ];
    if (urgencyPatterns.some((pattern) => pattern.test(lowerMessage))) {
        return true;
    }

    // Multiple punctuation
    if (/[!?]{2,}/.test(normalized)) {
        return true;
    }

    // Frustration/negative sentiment words
    const frustrationWords = [
        /\bmolesto\b/,
        /\bmolesta\b/,
        /\bcansado\b/,
        /\bcansada\b/,
        /\bharto\b/,
        /\bharta\b/,
        /\bespero\b.*\btanto\b/,
        /\bdemora\b/,
        /\btarda\b/,
        /\bsiempre\b.*\bmismo\b/,
    ];
    if (frustrationWords.some((pattern) => pattern.test(lowerMessage))) {
        return true;
    }

    return false;
}

/**
 * Detect if user is stalling/needs patience (not ready to provide info)
 * 
 * Signals:
 * - "no lo tengo" / "no tengo"
 * - "te mando luego" / "después"
 * - "un momento" / "espera"
 * - "busco" / "buscando"
 */
export function detectNeedsPatience(message: string): boolean {
    if (!message || message.length < 3) return false;

    const lowerMessage = message.toLowerCase().trim();

    const patiencePatterns = [
        /no\s+(lo\s+)?tengo/,
        /no\s+tengo.*\b(mano|aquí|acá)\b/,
        /te\s+(mando|envío|envio)\s+(luego|después|más\s+tarde)/,
        /\b(luego|después|más\s+tarde)\b/,
        /\bun\s+momento\b/,
        /\bespera\b/,
        /\besper[ao]\b/,
        /\b(busco|buscando)\b/,
        /\bahorita\b/,
        /\bya\s+te\s+(digo|mando|envío)\b/,
    ];

    return patiencePatterns.some((pattern) => pattern.test(lowerMessage));
}

/**
 * Check if message is acknowledgment/filler (ok, gracias, listo, etc.)
 * These should be met with silence or minimal response
 */
export function isAcknowledgment(message: string): boolean {
    if (!message || message.length > 30) return false;

    const normalized = message.toLowerCase().trim();
    
    const acknowledgmentPatterns = [
        /^(ok|okay|vale|dale|ya|sí|si|claro|entiendo|perfecto|listo)$/,
        /^gracias$/,
        /^👍$/,
        /^🙏$/,
    ];

    return acknowledgmentPatterns.some((pattern) => pattern.test(normalized));
}

/**
 * Analyze full conversation context to generate signals
 * 
 * @param currentMessage - User's current message
 * @param previousState - Current conversation state
 * @param messageCount - Number of times user has messaged in current state
 * @param lastBotMessageTime - Timestamp of last bot message
 * @returns ConversationSignals for intelligent variant selection
 */
export function analyzeContext(
    currentMessage: string,
    previousState: string,
    messageCount: number,
    lastBotMessageTime?: Date,
): ConversationSignals {
    const signals: ConversationSignals = {
        tone: "neutral",
        repeatRequestCount: messageCount > 1 ? messageCount - 1 : 0,
    };

    // Calculate waiting time if available
    if (lastBotMessageTime) {
        const now = new Date();
        signals.waitingTime = Math.floor((now.getTime() - lastBotMessageTime.getTime()) / 1000);
    }

    // Detect frustration
    signals.frustrated = detectFrustration(currentMessage);

    // Detect if user needs patience
    signals.needsPatience = detectNeedsPatience(currentMessage);

    // Detect repeat request (multiple messages in same state)
    signals.repeatRequest = messageCount > 1;

    return signals;
}

/**
 * Tone Detector - Detects user's communication style for tone matching
 * 
 * Analyzes formality level (formal/casual/neutral) to select appropriate
 * response variants.
 */

export type ToneLevel = "formal" | "casual" | "neutral";

/**
 * Detect tone/formality level of user message
 * 
 * Formal indicators:
 * - "usted" pronouns
 * - "señor/señora"
 * - Formal greetings (buenos días, buenas tardes)
 * - Complete sentences
 * - Professional vocabulary
 * 
 * Casual indicators:
 * - "tú" pronouns (implicitly most Spanish)
 * - Slang (bacán, chévere, pata)
 * - Abbreviations (tmb, q, xq)
 * - Emojis
 * - Informal greetings (hola, qué tal)
 * 
 * @param message - User message to analyze
 * @returns Tone level: "formal", "casual", or "neutral"
 */
export function detectTone(message: string): ToneLevel {
    if (!message || message.length < 3) return "neutral";

    const normalized = message.toLowerCase().trim();
    let formalScore = 0;
    let casualScore = 0;

    // Formal indicators
    const formalPatterns = [
        { pattern: /\busted\b/, weight: 3 },
        { pattern: /\bseñor\b|\bseñora\b/, weight: 2 },
        { pattern: /\bbuenos días\b|\bbuenas tardes\b|\bbuenas noches\b/, weight: 2 },
        { pattern: /\bdisculpe\b/, weight: 1 },
        { pattern: /\bpor favor\b/, weight: 1 },
        { pattern: /\bagradezco\b|\bquisiera\b/, weight: 1 },
    ];

    for (const { pattern, weight } of formalPatterns) {
        if (pattern.test(normalized)) {
            formalScore += weight;
        }
    }

    // Casual indicators
    const casualPatterns = [
        { pattern: /\b(bacán|bacano|chévere|chvr|chvere|mazo)\b/, weight: 3 },
        { pattern: /\b(pata|brother|bro|causa|compa)\b/, weight: 2 },
        { pattern: /\b(wey|we|xd|lol)\b/, weight: 2 },
        { pattern: /\b(tmb|tb|q\s|xq|xk|porq)\b/, weight: 2 },
        { pattern: /😊|😄|😁|👍|🙏|❤️/, weight: 1 },
        { pattern: /\b(pe|oye|oe)\b/, weight: 1 },
        { pattern: /\b(así nomás|nomás|ps)\b/, weight: 1 },
    ];

    for (const { pattern, weight } of casualPatterns) {
        if (pattern.test(normalized)) {
            casualScore += weight;
        }
    }

    // Message length and structure
    // Very short messages (<10 chars) tend to be casual
    if (message.length < 10 && !/\busted\b/.test(normalized)) {
        casualScore += 1;
    }

    // All caps is generally casual/urgent
    const letters = message.replace(/[^a-záéíóúñA-ZÁÉÍÓÚÑ]/g, "");
    if (letters.length > 5) {
        const uppercaseCount = (letters.match(/[A-ZÁÉÍÓÚÑ]/g) || []).length;
        if (uppercaseCount / letters.length > 0.7) {
            casualScore += 1;
        }
    }

    // Determine tone based on scores
    if (formalScore > casualScore && formalScore >= 2) {
        return "formal";
    }
    if (casualScore > formalScore && casualScore >= 2) {
        return "casual";
    }

    return "neutral";
}

/**
 * Check if greeting is formal
 * Useful for first message analysis
 */
export function isFormalGreeting(message: string): boolean {
    const normalized = message.toLowerCase().trim();
    const formalGreetings = [
        /\bbuenos días\b/,
        /\bbuenas tardes\b/,
        /\bbuenas noches\b/,
        /\bestimado\b/,
        /\bestimada\b/,
    ];
    return formalGreetings.some((pattern) => pattern.test(normalized));
}

/**
 * Check if greeting is casual
 */
export function isCasualGreeting(message: string): boolean {
    const normalized = message.toLowerCase().trim();
    const casualGreetings = [
        /^(hola|ola|oe|oye)\b/,
        /^(qué\s+tal|que\s+tal|q\s+tal)\b/,
        /^(buenas)\s*$/,
        /^(holi|holaaa)\b/,
    ];
    return casualGreetings.some((pattern) => pattern.test(normalized));
}

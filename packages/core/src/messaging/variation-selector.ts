/**
 * Variation Selector - Prevents robotic repetition by rotating message variants
 * 
 * Core principle: Never repeat the same message variant within a conversation session.
 * Uses session-based tracking to ensure natural variation.
 */

export type VariantKey = string; // e.g., "GREETING", "COLLECT_DNI"

export interface VariantContext {
    usedVariantKeys?: Record<VariantKey, number>; // Key -> variant index used
}

/**
 * Select a variant from an array, avoiding previously used ones in this session
 * 
 * @param variants - Array of message variations
 * @param key - Unique key for this message type (e.g., "GREETING")
 * @param context - Conversation context containing used variant tracking
 * @returns Selected variant string and updated context
 */
export function selectVariant(
    variants: string[],
    key: VariantKey,
    context: VariantContext,
): { message: string; updatedContext: Partial<VariantContext> } {
    if (!variants || variants.length === 0) {
        throw new Error(`No variants provided for key: ${key}`);
    }

    // Single variant - no selection needed
    if (variants.length === 1) {
        return {
            message: variants[0] ?? "",
            updatedContext: {},
        };
    }

    const usedVariantKeys = context.usedVariantKeys || {};
    const previousIndex = usedVariantKeys[key];

    // Get available indices (not previously used)
    const availableIndices = variants
        .map((_, index) => index)
        .filter((index) => index !== previousIndex);

    // If all variants used, reset for this key
    const indices =
        availableIndices.length > 0
            ? availableIndices
            : variants.map((_, index) => index);

    // Random selection from available
    const selectedIndex = indices[Math.floor(Math.random() * indices.length)] ?? 0;

    return {
        message: variants[selectedIndex] ?? "",
        updatedContext: {
            usedVariantKeys: {
                ...usedVariantKeys,
                [key]: selectedIndex,
            } as Record<string, number>,
        },
    };
}

/**
 * Select variant with contextual awareness (frustration, patience needed, etc.)
 * 
 * @param variants - Object with categorized variant arrays
 * @param key - Base key for tracking
 * @param context - Conversation context
 * @param signals - Contextual signals for smart selection
 * @returns Selected variant and updated context
 */
export interface ContextSignals {
    frustrated?: boolean; // User showing frustration
    needsPatience?: boolean; // User needs more time
    repeatRequest?: boolean; // Asking same thing again
    tone?: "formal" | "casual" | "neutral";
}

export interface CategorizedVariants {
    standard: string[];
    empathetic?: string[];
    patient?: string[];
    casual?: string[];
    formal?: string[];
}

export function selectVariantWithContext(
    variants: CategorizedVariants,
    key: VariantKey,
    context: VariantContext,
    signals: ContextSignals = {},
): { message: string; updatedContext: Partial<VariantContext> } {
    // Select appropriate category based on signals
    let selectedCategory = variants.standard;

    if (signals.frustrated && variants.empathetic) {
        selectedCategory = variants.empathetic;
        key = `${key}_empathetic`;
    } else if (signals.needsPatience && variants.patient) {
        selectedCategory = variants.patient;
        key = `${key}_patient`;
    } else if (signals.tone === "casual" && variants.casual) {
        selectedCategory = variants.casual;
        key = `${key}_casual`;
    } else if (signals.tone === "formal" && variants.formal) {
        selectedCategory = variants.formal;
        key = `${key}_formal`;
    }

    return selectVariant(selectedCategory, key, context);
}

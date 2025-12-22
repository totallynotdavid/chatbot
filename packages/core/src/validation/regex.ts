export const DNI_REGEX = /^\d{8}$/;
export const AGE_REGEX = /^\d{1,3}$/;

export function isValidDNI(input: string): boolean {
    return DNI_REGEX.test(input.trim());
}

export function extractDNI(input: string): string | null {
    // First, try to find exactly 8 digits surrounded by non-digits or boundaries
    // This prevents extracting from phone numbers or longer digit sequences
    const exactMatch = input.match(/(?<!\d)\d{8}(?!\d)/);
    if (exactMatch) {
        return exactMatch[0];
    }
    
    // If no exact match, try cleaning all non-digits and check if exactly 8 remain
    // This handles cases like "72-345-678" or "DNI: 72 345 678"
    const cleaned = input.replace(/\D/g, "");
    if (cleaned.length === 8) {
        return cleaned;
    }
    
    return null;
}

export function isValidAge(input: string): boolean {
    const cleaned = input.trim();
    if (!AGE_REGEX.test(cleaned)) return false;
    const age = parseInt(cleaned, 10);
    return age >= 18 && age <= 120;
}

export function extractAge(input: string): number | null {
    const cleaned = input.replace(/\D/g, "");
    if (cleaned.length > 0 && cleaned.length <= 3) {
        const age = parseInt(cleaned, 10);
        if (age >= 18 && age <= 120) {
            return age;
        }
    }
    return null;
}

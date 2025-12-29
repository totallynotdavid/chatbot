/**
 * Extracts and formats the first name from a full name string.
 * Converts to proper Title Case for professional, friendly communication.
 * 
 * @param fullName - Full name string (may be in ALL CAPS or mixed case)
 * @returns First name in Title Case, or "Cliente" if no valid name
 * 
 * @example
 * formatFirstName("YASMIN MARITZA ARAMBURU BERNALES") // "Yasmin"
 * formatFirstName("Juan Carlos") // "Juan"
 * formatFirstName("") // "Cliente"
 */
export function formatFirstName(fullName: string | null | undefined): string {
    // Handle null, undefined, or empty strings
    if (!fullName || fullName.trim() === "") {
        return "Cliente";
    }

    // Split by spaces and get first part
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts[0];

    // Handle edge case where split might return empty string
    if (!firstName || firstName.length === 0) {
        return "Cliente";
    }

    // Convert to Title Case (first letter uppercase, rest lowercase)
    return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

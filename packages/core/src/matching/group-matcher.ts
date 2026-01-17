import { CATEGORY_GROUPS, type CategoryGroup } from "@totem/types";

/**
 * Match user input to a category group for progressive disclosure.
 *
 * This enables natural conversation flows like:
 * - "tecnología" → shows celulares, laptops, audio
 * - "para el hogar" → shows lavadoras, refrigeradoras, etc.
 *
 * @param input - User message to match against groups
 * @returns Matched CategoryGroup or null if no match
 */

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function matchGroup(input: string): CategoryGroup | null {
  const normalized = removeAccents(input.toLowerCase().trim());

  for (const key of Object.keys(CATEGORY_GROUPS) as CategoryGroup[]) {
    const config = CATEGORY_GROUPS[key];

    if (normalized === removeAccents(key)) {
      return key;
    }

    // Check if the display name contains user input (reversed from before!)
    const normalizedDisplay = removeAccents(config.display.toLowerCase());
    if (normalizedDisplay.includes(normalized)) {
      return key;
    }

    if (
      key === "hogar" &&
      /linea\s+blanca|para\s+el\s+hogar|electrodom[ee]sticos|para\s+casa/.test(
        normalized,
      )
    ) {
      return "hogar";
    }

    if (
      key === "tecnología" &&
      /tecnolog[ii]a|tech|electr[oo]nica/.test(normalized)
    ) {
      return "tecnología";
    }
  }

  return null; // No match, will fall through to other matching logic
}

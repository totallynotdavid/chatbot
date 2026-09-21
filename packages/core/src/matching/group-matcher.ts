import { CATEGORY_GROUPS, type CategoryGroup } from "@vendeya/types";

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
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);

  for (const key of Object.keys(CATEGORY_GROUPS) as CategoryGroup[]) {
    const config = CATEGORY_GROUPS[key];

    if (normalized === removeAccents(key)) {
      return key;
    }

    // The whole message names the group in whole words ("hogar", "linea
    // blanca") or starts one ("tecno"). A substring test let "no" pick one.
    const displayWords = removeAccents(config.display.toLowerCase())
      .split(/\s+/)
      .filter((word) => word.length >= 4);
    const namesGroup =
      tokens.length > 0 &&
      tokens.every((token) => displayWords.includes(token));
    const single = tokens.length === 1 ? tokens[0] : undefined;
    const startsGroupWord =
      single !== undefined &&
      single.length >= 4 &&
      displayWords.some((word) => word.startsWith(single));
    if (namesGroup || startsGroupWord) {
      return key;
    }

    if (
      key === "hogar" &&
      /\b(linea\s+blanca|para\s+el\s+hogar|electrodomesticos|para\s+casa)\b/.test(
        normalized,
      )
    ) {
      return "hogar";
    }

    if (
      key === "tecnología" &&
      /\b(tecnologia|tech|electronica)\b/.test(normalized)
    ) {
      return "tecnología";
    }
  }

  return null; // No match, will fall through to other matching logic
}

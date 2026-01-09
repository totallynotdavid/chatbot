/**
 * Product that was sent to the customer
 */
export type SentProduct = {
  name: string;
  position: number;
  productId?: string;
};

/**
 * Smart product selection matcher with layered approach:
 * 1. Exact product name match (FREE, 0ms)
 * 2. Ordinal/position match (FREE, 0ms)
 * 3. Fuzzy brand/model match (FREE, 0ms)
 * 4. Return null for LLM fallback (PAID, 200ms)
 */
export function matchProductSelection(
  message: string,
  sentProducts: SentProduct[],
): SentProduct | null {
  const lower = message.toLowerCase().trim();

  // Priority 1: Exact product name match
  for (const product of sentProducts) {
    const productNameLower = product.name.toLowerCase();
    // Remove common prefixes/suffixes for better matching
    const cleanMessage = lower
      .replace(/^(el|la|los|las|un|una|unos|unas)\s+/, "")
      .replace(/\s+(por favor|gracias|pls?)$/i, "");

    if (
      productNameLower.includes(cleanMessage) ||
      cleanMessage.includes(productNameLower)
    ) {
      return product;
    }
  }

  // Priority 2: Ordinal/position match
  const ordinalMatch = lower.match(
    /\b(el|la|los|las)?\s*(primer|segund|tercer|cuart|quint|sext|1er|1ro|1ra|2do|2da|3ro|3ra|4to|4ta|5to|5ta|6to|6ta|uno|dos|tres|cuatro|cinco|seis)\w*\b/,
  );
  if (ordinalMatch) {
    const ordinal = ordinalMatch[0];
    let position = 0;

    // Map ordinals to positions
    if (/\b(primer|1er|1ro|1ra|uno)\b/.test(ordinal)) position = 1;
    else if (/\b(segund|2do|2da|dos)\b/.test(ordinal)) position = 2;
    else if (/\b(tercer|3ro|3ra|tres)\b/.test(ordinal)) position = 3;
    else if (/\b(cuart|4to|4ta|cuatro)\b/.test(ordinal)) position = 4;
    else if (/\b(quint|5to|5ta|cinco)\b/.test(ordinal)) position = 5;
    else if (/\b(sext|6to|6ta|seis)\b/.test(ordinal)) position = 6;

    const product = sentProducts.find((p) => p.position === position);
    if (product) return product;
  }

  // Priority 3: Fuzzy brand/model match
  const brandKeywords = extractBrandKeywords(lower);
  if (brandKeywords.length > 0) {
    for (const product of sentProducts) {
      const productWords = product.name.toLowerCase().split(/\s+/);
      // Check if any brand keyword matches product name
      if (
        brandKeywords.some((keyword) =>
          productWords.some(
            (word: string) => word.includes(keyword) || keyword.includes(word),
          ),
        )
      ) {
        return product;
      }
    }
  }

  // Priority 4: No match found, return null for LLM fallback
  return null;
}

function extractBrandKeywords(message: string): string[] {
  const words = message.toLowerCase().split(/\s+/);
  const brandKeywords: string[] = [];

  // Common brand patterns
  const brandPatterns = [
    // Phone brands
    "samsung",
    "galaxy",
    "iphone",
    "apple",
    "huawei",
    "xiaomi",
    "redmi",
    "motorola",
    "lg",
    // Appliance brands
    "mabe",
    "lg",
    "samsung",
    "whirlpool",
    "electrolux",
    "indurama",
    "rca",
    "panasonic",
    // TV brands
    "samsung",
    "lg",
    "panasonic",
    "tcl",
    "hisense",
    "philips",
    // Generic terms that might indicate specific products
    "a26",
    "a25",
    "a15",
    "note",
    "pro",
    "max",
    "plus",
    "ultra",
  ];

  for (const word of words) {
    // Skip common words
    if (
      [
        "el",
        "la",
        "los",
        "las",
        "un",
        "una",
        "me",
        "te",
        "le",
        "se",
        "lo",
        "que",
        "de",
        "en",
        "con",
        "por",
        "para",
        "como",
        "si",
        "no",
        "es",
        "son",
        "este",
        "esta",
        "esto",
        "ese",
        "esa",
        "eso",
      ].includes(word)
    ) {
      continue;
    }

    // Check if word matches or contains brand patterns
    if (
      brandPatterns.some(
        (brand) => word.includes(brand) || brand.includes(word),
      )
    ) {
      brandKeywords.push(word);
    }
  }

  return brandKeywords;
}

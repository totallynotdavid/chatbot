export type SentProduct = {
  name: string;
  position: number;
  productId?: string;
  price?: number;
};

/**
 * Smart product selection matcher with layered approach:
 * 1. Exact product name match (FREE, 0ms)
 * 2. Ordinal/position match (FREE, 0ms)
 * 3. Fuzzy brand/model match (FREE, 0ms)
 * 4. Return null for LLM fallback (PAID, 200ms)
 *
 * @returns Single product if unique match, or null if no match/ambiguous
 */
export function matchProductSelection(
  message: string,
  sentProducts: SentProduct[],
): SentProduct | null {
  const matches = matchAllProducts(message, sentProducts);

  // Only return if exactly one match
  if (matches.length === 1) {
    const match = matches[0];
    return match ?? null;
  }
  return null;
}

/**
 * Find all products that match the message
 * Used for detecting ambiguous selections
 */
export function matchAllProducts(
  message: string,
  sentProducts: SentProduct[],
): SentProduct[] {
  const lower = message.toLowerCase().trim();
  console.log(
    `[ProductMatch] Matching "${message}" against ${sentProducts.length} products`,
  );

  // Priority 1: Exact product name match (may match multiple)
  // Extract potential product references by removing common phrases
  let cleanMessage = lower
    .replace(
      /(me interesa|quiero|quisiera|me gustaría|dame|deme|me llevo)/gi,
      "",
    )
    .replace(/\b(el|la|los|las|un|una|unos|unas)\b/g, "")
    .replace(/\s+(por favor|gracias|pls?)\s*$/i, "")
    .trim()
    .replace(/\s+/g, " "); // normalize spaces

  const exactMatches: SentProduct[] = [];
  for (const product of sentProducts) {
    const productNameLower = product.name.toLowerCase();

    if (
      productNameLower.includes(cleanMessage) ||
      cleanMessage.includes(productNameLower)
    ) {
      exactMatches.push(product);
    }
  }
  if (exactMatches.length > 0) {
    console.log(
      `[ProductMatch] Priority 1 (exact): Found ${exactMatches.length} matches:`,
      exactMatches.map((p) => p.name),
    );
    return exactMatches;
  }

  // Priority 2: Ordinal/position match
  const ordinalMatch = lower.match(
    /\b(el|la|los|las)?\s*(primer|segund|tercer|cuart|quint|sext|1er|1ro|1ra|2do|2da|3ro|3ra|4to|4ta|5to|5ta|6to|6ta|uno|dos|tres|cuatro|cinco|seis)\w*\b/,
  );
  if (ordinalMatch) {
    const ordinal = ordinalMatch[0];
    let position = 0;

    // Map ordinals to positions (check if ordinal contains the keyword)
    if (/primer|1er|1ro|1ra|uno/.test(ordinal)) position = 1;
    else if (/segund|2do|2da|dos/.test(ordinal)) position = 2;
    else if (/tercer|3ro|3ra|tres/.test(ordinal)) position = 3;
    else if (/cuart|4to|4ta|cuatro/.test(ordinal)) position = 4;
    else if (/quint|5to|5ta|cinco/.test(ordinal)) position = 5;
    else if (/sext|6to|6ta|seis/.test(ordinal)) position = 6;

    const product = sentProducts.find((p) => p.position === position);
    if (product) {
      console.log(
        `[ProductMatch] Priority 2 (ordinal): Matched "${ordinal}" to position ${position}:`,
        product.name,
      );
      return [product];
    }
    console.log(
      `[ProductMatch] Priority 2 (ordinal): Matched "${ordinal}" to position ${position} but no product found`,
    );
  }

  // Priority 3: Extract significant tokens from message and match against product tokens
  const messageTokens = extractSignificantTokens(lower);
  if (messageTokens.length > 0) {
    console.log(
      `[ProductMatch] Priority 3 (tokens): Extracted from message:`,
      messageTokens,
    );
    const matches: SentProduct[] = [];
    for (const product of sentProducts) {
      const productTokens = extractSignificantTokens(product.name);
      // Match if any message token appears in product tokens
      const hasMatch = messageTokens.some((msgToken) =>
        productTokens.some(
          (prodToken) =>
            prodToken.includes(msgToken) || msgToken.includes(prodToken),
        ),
      );
      if (hasMatch) {
        matches.push(product);
      }
    }
    if (matches.length > 0) {
      console.log(
        `[ProductMatch] Priority 3 (tokens): Found ${matches.length} matches:`,
        matches.map((p) => p.name),
      );
      return matches;
    }
  }

  // Priority 4: No match found
  console.log(`[ProductMatch] No matches found for "${message}"`);
  return [];
}

/**
 * Extract intent from message if it contains specific product identifiers
 */
export function extractProductIntent(
  message: string,
): { type: "specific"; query: string } | null {
  const lower = message.toLowerCase();

  // 1. Check for explicit intent phrases + specific specifiers
  // "quiero un iphone", "busco samsung", "tienes motorola"
  const intentPhrase =
    /(quiero|quisiera|busco|tienes|tienen|tráeme|muéstrame|ver|comprar|necesito|interesa)/;
  const hasIntent = intentPhrase.test(lower);

  // 2. cleaning the message to extract the "what"
  // Remove common start phrases
  let cleanQuery = lower
    .replace(
      /^(hola|buenos\s+dias|buenas\s+tardes|buenas\s+noches|dime|oye|por\s+favor)/g,
      "",
    )
    .replace(
      /(me interesa|quiero|quisiera|me gustaría|dame|deme|me llevo|busco|necesito|tienes|ver|comprar)/gi,
      "",
    )
    .replace(/\b(el|la|los|las|un|una|unos|unas)\b/g, "") // articles
    .replace(/\b(celular|telefono|equipo|smartphone|movil)\b/g, "") // generic categories
    .trim();

  // If the query is empty or too short, it's likely just "quiero un celular" (generic)
  if (cleanQuery.length < 2) return null;

  // 3. Validate if the remaining text looks like a product specifier
  // Common brands/models we expect (not exhaustive, just heuristic)
  const isLikelyProduct =
    /(iphone|samsung|galaxy|xiaomi|redmi|motorola|moto|honor|huawei|zte|oppo|vivo|realme|infinix|tecno|nokia|lg|sony|pixel|pro|max|ultra|plus|lite|note)\b/.test(
      cleanQuery,
    ) ||
    // Or it has alphanumeric structure like "a14", "s23", "15 pro"
    /\b([a-z]+[0-9]+|[0-9]+[a-z]+)\b/.test(cleanQuery);

  if (hasIntent && isLikelyProduct) {
    return { type: "specific", query: cleanQuery };
  }

  // Also catch direct mentions without intent phrase if they are very specific
  // e.g. "iPhone 15 Pro Max"
  if (cleanQuery.length > 5 && isLikelyProduct) {
    return { type: "specific", query: cleanQuery };
  }

  return null;
}

/**
 * Extract significant tokens from text (brands, models, alphanumeric sequences)
 * Filters out common Spanish stopwords
 * Works dynamically with any product name - no hardcoded model lists
 */
function extractSignificantTokens(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const stopwords = new Set([
    "el",
    "la",
    "los",
    "las",
    "un",
    "una",
    "unos",
    "unas",
    "de",
    "del",
    "en",
    "por",
    "para",
    "con",
    "sin",
    "que",
    "como",
    "si",
    "no",
    "me",
    "te",
    "se",
    "le",
    "lo",
    "su",
    "es",
    "son",
    "este",
    "esta",
    "ese",
    "esa",
    "y",
    "o",
    "pero",
    "mas",
  ]);

  return words.filter((word) => {
    // Keep words that are:
    // - Length >= 2 characters
    // - Not common stopwords
    // - Alphanumeric (brands, models, identifiers)
    if (word.length < 2) return false;
    if (stopwords.has(word)) return false;
    // Keep if contains letters or numbers
    return /[a-z0-9]/.test(word);
  });
}

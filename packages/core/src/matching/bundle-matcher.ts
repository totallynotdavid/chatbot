import type { Bundle } from "@totem/types";

/**
 * Match user message to bundles using category-based regex patterns.
 * This is a fallback when LLM doesn't match a specific bundle.
 *
 * Example: "quiero ver celulares" → bundles with primary_category="celulares"
 */
export function matchBundlesByCategory(
  message: string,
  affordableBundles: Bundle[],
): Bundle[] {
  const lower = message.toLowerCase();

  const categoryPatterns: Record<string, RegExp> = {
    celulares:
      /(celular|smartphone|celu|telefono|phone|movil|iphone|samsung|galaxy|xiaomi|redmi|motorola|huawei)/,
    cocinas: /(cocina|cocineta)/,
    tv: /(televisor|television|tele|pantalla|smart tv|lg|sony|hisense|jvc)/,
    refrigeradoras: /(refrigerador|refri|heladera)/,
    lavadoras: /(lavadora|lava)/,
    termas: /(terma|calentador|calent)/,
    fusion: /(combo|paquete|bundle)/,
  };

  // Find matching category
  for (const [category, pattern] of Object.entries(categoryPatterns)) {
    if (pattern.test(lower)) {
      const matches = affordableBundles.filter(
        (b) => b.primary_category === category,
      );

      if (matches.length > 0) {
        return matches;
      }
    }
  }

  return [];
}

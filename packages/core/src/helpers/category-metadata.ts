import { CATEGORIES } from "@vendeya/types";

export type CategoryMetadata = {
  key: string;
  aliases: readonly string[];
  brands: readonly string[];
};

export function getCategoryMetadata(
  categoryKeys: string[],
): CategoryMetadata[] {
  const result: CategoryMetadata[] = [];

  for (const key of categoryKeys) {
    const config = CATEGORIES[key as keyof typeof CATEGORIES];
    if (config) {
      result.push({
        key: key,
        aliases: config.aliases,
        brands: config.brands,
      });
    }
  }

  return result;
}

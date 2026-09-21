import { CATEGORIES } from "@vendeya/types";

export function formatCategoryList(categoryKeys: string[]): string {
  if (!categoryKeys || categoryKeys.length === 0) {
    return "nuestros productos disponibles";
  }

  const displayNames = categoryKeys
    .map((key) => {
      const config = CATEGORIES[key as keyof typeof CATEGORIES];
      return config?.display.toLowerCase() || key;
    })
    .filter(Boolean);

  if (displayNames.length === 0) {
    return "nuestros productos disponibles";
  }

  if (displayNames.length === 1) {
    return displayNames[0] ?? "nuestros productos disponibles";
  }

  if (displayNames.length === 2) {
    return `${displayNames[0]} y ${displayNames[1]}`;
  }

  const last = displayNames.pop();
  return `${displayNames.join(", ")} y ${last}`;
}

export function getCategoryDisplayNames(categoryKeys: string[]): string[] {
  return categoryKeys
    .map((key) => {
      const config = CATEGORIES[key as keyof typeof CATEGORIES];
      return config?.display.toLowerCase() || key;
    })
    .filter(Boolean);
}

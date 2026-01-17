import type { Bundle } from "@totem/types";

export function buildExtractBundleIntentPrompt(
  affordableBundles: Bundle[],
): string {
  if (affordableBundles.length === 0) {
    return `No hay bundles disponibles para este cliente.

JSON: {"bundleIndex": null, "confidence": 0}`;
  }

  const bundleList = affordableBundles
    .map((b, idx) => `${idx + 1}. ${b.name} - S/${b.price}`)
    .join("\n");

  return `El cliente puede comprar estos bundles:

${bundleList}

Tarea: ¿El usuario está pidiendo alguno de estos bundles específicamente?

Reglas:
- Si menciona un producto/categoría que coincide claramente con un bundle, devuelve el índice (1-based)
- Si no coincide con ninguno o es ambiguo, devuelve null
- Solo devuelve un índice si estás SEGURO de que el usuario quiere algo de esta lista

Ejemplos:
- "Quiero un celular" → Si hay 1 bundle de celulares, devuelve su índice. Si hay varios, devuelve null (ambiguo)
- "Me interesa el Samsung Galaxy A56" → Busca nombre exacto, devuelve índice si encuentra
- "Tienen algo para la casa?" → null (muy ambiguo)
- "El segundo" → Devuelve 2

JSON: {"bundleIndex": number | null, "confidence": number}`;
}

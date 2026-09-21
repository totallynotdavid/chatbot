import type { ConversationMetadata, ConversationPhase } from "@vendeya/core";

export function formatConversationDetails(
  metadata: Partial<ConversationMetadata>,
  phase: ConversationPhase | null,
  phoneNumber: string,
): string {
  const name =
    metadata.name ||
    (phase && "name" in phase ? phase.name : null) ||
    "No disponible";
  const dni =
    metadata.dni ||
    (phase && "dni" in phase ? phase.dni : null) ||
    "No disponible";

  let producto = "No disponible";
  if (phase) {
    if (
      "selectedProduct" in phase &&
      phase.selectedProduct &&
      phase.selectedProduct.name
    ) {
      const price = phase.selectedProduct.price || 0;
      producto = `${phase.selectedProduct.name} (S/ ${price.toFixed(2)})`;
    } else if (
      "interestedProduct" in phase &&
      phase.interestedProduct &&
      phase.interestedProduct.name
    ) {
      const price = phase.interestedProduct.price || 0;
      producto = `${phase.interestedProduct.name} (S/ ${price.toFixed(2)})`;
    }
  }

  return `Nombre: ${name}\nDNI: ${dni}\nTeléfono: ${phoneNumber}\nProducto: ${producto}`;
}

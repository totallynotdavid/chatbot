import type { BusinessFacts } from "./business-facts.ts";

export function buildWarrantyAnswerPrompt(
  facts: BusinessFacts["warranty"],
): string {
  return `Customer asked about warranty/guarantee.

Facts:
- Duración: ${facts.duration}
- Cobertura: ${facts.coverage}
- Proveedor: ${facts.provider}
- No cubre: ${facts.exclusions}

Answer naturally in 2-3 lines. Be clear and reassuring.

JSON: {"answer": "your response"}`;
}

export function buildDeliveryAnswerPrompt(
  facts: BusinessFacts["delivery"],
): string {
  return `Customer asked about delivery/shipping.

Facts:
- Costo: ${facts.cost}
- Tiempo: ${facts.time}
- Cobertura: ${facts.coverage.join(", ")}
- ${facts.notes}

Answer naturally in 2-3 lines.

JSON: {"answer": "your response"}`;
}

export function buildContractAnswerPrompt(
  facts: BusinessFacts["contract"],
): string {
  return `Customer asked about contract/signing process.

Facts:
- Método: ${facts.method}
- Duración llamada: ${facts.duration}
- Requisitos: ${facts.requirements.join(", ")}
- Legal: ${facts.legal}
- Cuándo: ${facts.timing}

Answer naturally in 2-3 lines. Be clear about the recording.

JSON: {"answer": "your response"}`;
}

export function buildPaymentAnswerPrompt(
  facts: BusinessFacts["payment"],
  creditLine?: number,
): string {
  const creditInfo = creditLine
    ? `\n- Tu línea disponible: S/ ${creditLine}`
    : "";

  return `Customer asked about payment.

Facts:
- Método: ${facts.method}
- Cuota inicial: ${facts.downPayment}
- Plazos disponibles: ${facts.terms.join(", ")}
- ${facts.automatic}${creditInfo}

Answer naturally in 2-3 lines.

JSON: {"answer": "your response"}`;
}

export function buildReturnsAnswerPrompt(
  facts: BusinessFacts["returns"],
): string {
  return `Customer asked about returns/refunds.

Facts:
- Plazo: ${facts.period}
- Condición: ${facts.condition}
- Proceso: ${facts.process}
- Devolución: ${facts.refund}
- Nota: ${facts.notes}

Answer naturally in 2-3 lines. Be clear about the condition.

JSON: {"answer": "your response"}`;
}

export function buildCoverageAnswerPrompt(
  facts: BusinessFacts["coverage"],
): string {
  return `Customer asked about delivery coverage/zones.

Facts:
- Zonas: ${facts.zones.join(" y ")}
- ${facts.distritos}
- Excluido: ${facts.excluded}

Answer naturally in 2-3 lines.

JSON: {"answer": "your response"}`;
}

export function buildProductAnswerPrompt(
  availableProducts: Array<{ name: string; price: number; category: string }>,
  categoryName?: string,
): string {
  const productsText = availableProducts.length
    ? availableProducts.map((p) => `- ${p.name}: S/ ${p.price}`).join("\n")
    : "No hay productos disponibles en este momento";

  const categoryNote = categoryName
    ? `\nCategoría consultada: ${categoryName}`
    : "";

  return `Customer asked about products.${categoryNote}

Available products:
${productsText}

If product exists, mention it with price. If not, suggest alternatives from the list.
Answer naturally in 2-3 lines.

JSON: {"answer": "your response"}`;
}

export function buildAnswerQuestionPrompt(context: {
  segment?: string;
  creditLine?: number;
  state?: string;
  availableCategories?: string[];
}): string {
  const creditInfo = context.creditLine
    ? `Línea de crédito disponible: S/ ${context.creditLine}.`
    : "";

  const categories =
    context.availableCategories?.join(", ") || "electrodomésticos";

  return `Eres asesor de Totem en Perú. Vendes electrodomésticos con pago en cuotas.

CONTEXTO:
- Productos disponibles: ${categories}
- Pago: cuotas mensuales en recibo de Calidda
- Zona: Lima Metropolitana y Callao
${creditInfo}

Respondes preguntas sobre productos, financiamiento, zonas, proceso de compra.

Respuesta: breve (2 líneas), natural, cierra con "¿Qué producto te interesa?"

JSON: {"answer": "tu respuesta"}`;
}

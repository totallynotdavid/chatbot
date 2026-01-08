/**
 * LLM System Prompts — Optimized for precision and minimal context
 *
 * Structure: Role → Task → Constraints → Output
 * Single responsibility per function
 */

// Minimal context for generative prompts only
const CORE_CONTEXT = `Totem vende electrodomésticos (celulares, cocinas, refrigeradoras, laptops, TVs, termas) en Lima/Callao.
Pago: cuotas mensuales en recibo de Calidda.`;

/**
 * Binary question detection — single responsibility
 */
export function buildIsQuestionPrompt(): string {
  return `¿El mensaje es una pregunta?

Una pregunta es: contiene "?", o usa palabras interrogativas (qué, cuánto, cómo, dónde, cuándo, por qué), o pide información.

NO es pregunta: afirmaciones, saludos, selecciones de producto, expresiones de interés.

JSON: {"isQuestion": boolean}`;
}

/**
 * Legacy intent classification — kept for backwards compatibility
 * @deprecated Use buildIsQuestionPrompt for new code
 */
export function buildClassifyIntentPrompt(): string {
  return `Clasifica la intención del mensaje en español.

CATEGORÍAS:
- "yes": afirmación (sí, claro, ok, vale, dale, por supuesto, afirmativo, correcto)
- "no": negación (no, nada, no gracias, paso, negativo)
- "question": pregunta (contiene ? o interrogativos: qué, cuánto, cómo, dónde)
- "product_selection": menciona producto específico o posición (el primero, el 2)
- "unclear": todo lo demás

JSON: {"intent": "yes"|"no"|"question"|"product_selection"|"unclear"}`;
}

/**
 * Category extraction — focused on product categories only
 */
export function buildExtractCategoryPrompt(
  availableCategories: string[],
): string {
  return `Extrae la categoría de producto mencionada.

CATEGORÍAS VÁLIDAS: ${availableCategories.join(", ")}

Mapea términos a categorías:
- Marcas celular (Samsung, iPhone, Xiaomi, Galaxy) → celulares
- "refri", "refrigeradora", "frigo" → refrigeradoras
- "tele", "TV", "televisor" → televisores
- "laptop", "portátil", "computadora" → laptops
- "cocina", "estufa" → cocinas
- "terma", "calentador" → termas

Devuelve la categoría exacta de la lista o null si no hay coincidencia.

JSON: {"category": "categoria" | null}`;
}

/**
 * Legacy entity extraction — kept for backwards compatibility
 * @deprecated Use buildExtractCategoryPrompt for new code
 */
export function buildExtractEntityPrompt(
  entity: string,
  availableCategories?: string[],
): string {
  if (entity === "product_category" && availableCategories?.length) {
    return buildExtractCategoryPrompt(availableCategories);
  }
  return `Extrae "${entity}" del mensaje. JSON: {"value": string | null}`;
}

/**
 * Question answering — defaults to NOT escalating
 */
export function buildAnswerQuestionPrompt(context: {
  segment?: string;
  creditLine?: number;
  state?: string;
}): string {
  const creditInfo = context.creditLine
    ? `Cliente tiene S/ ${context.creditLine} de línea de crédito.`
    : "";

  return `Eres un asesor de Totem, aliado de Calidda en Perú. Vendes electrodomésticos (celulares, cocinas, refrigeradoras, laptops, TVs, termas) con pago en cuotas mensuales en el recibo de Calidda. Solo entregas en Lima y Callao.
${creditInfo}

RESPONDE TÚ (requiresHuman: false) preguntas sobre:
- Financiamiento: cuotas se pagan en recibo de Calidda, sin intereses visibles
- Productos disponibles: celulares, cocinas, refrigeradoras, laptops, TVs, termas
- Zonas de entrega: solo Lima Metropolitana y Callao
- Proceso de compra: verificamos elegibilidad, mostramos productos, un asesor llama para finalizar

ESCALA (requiresHuman: true) ÚNICAMENTE si el cliente:
- Pide monto EXACTO de cuota mensual
- Pregunta tasa de interés específica
- Exige garantía de aprobación ("¿me van a aprobar?")
- Hace un reclamo o queja formal
- Pide descuento o modificar políticas

DEFAULT: requiresHuman es false. Responde breve (2 líneas), cierra preguntando qué producto le interesa.

JSON: {"answer": "respuesta", "requiresHuman": boolean}`;
}

/**
 * Alternative suggestion — minimal prompt
 */
export function buildSuggestAlternativePrompt(
  requestedCategory: string,
  availableCategories: string[],
): string {
  return `${CORE_CONTEXT}

"${requestedCategory}" no disponible. Opciones: ${availableCategories.join(", ")}.

Sugiere alternativa relevante (1-2 líneas), natural y amigable.

JSON: {"suggestion": "respuesta"}`;
}

/**
 * Backlog response — sanitized input, human-readable time
 */
export function buildHandleBacklogPrompt(
  message: string,
  ageMinutes: number,
): string {
  const sanitized = message.replace(/["\n\r]/g, " ").slice(0, 200);
  const timeAgo =
    ageMinutes < 60
      ? `${ageMinutes} minutos`
      : ageMinutes < 120
        ? "más de una hora"
        : `${Math.floor(ageMinutes / 60)} horas`;

  return `${CORE_CONTEXT}

Mensaje recibido hace ${timeAgo}: "${sanitized}"

Responde: reconoce demora brevemente, responde al mensaje, continúa conversación.
2-3 líneas máximo, natural.

JSON: {"response": "respuesta"}`;
}

// Legacy export
export const SALES_CONTEXT = CORE_CONTEXT;

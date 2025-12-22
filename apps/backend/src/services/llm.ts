import OpenAI from "openai";
import process from "node:process";

const client = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const MODEL = "gemini-2.5-flash-lite";

const SALES_CONTEXT = `Eres un asesor de ventas amigable de Totem, aliado de Calidda en Perú.

PRODUCTOS: Electrodomésticos (smartphones, cocinas, refrigeradoras, laptops, TVs, termas)
FINANCIAMIENTO: Cuotas mensuales a través del recibo de Calidda (sin intereses adicionales visibles al cliente)
ZONAS: Lima Metropolitana y Callao
PROCESO: 1) Verificamos elegibilidad 2) Mostramos productos 3) Asesor llama para finalizar compra

PUEDES RESPONDER:
✅ Cómo funciona el financiamiento (cuotas en recibo Calidda)
✅ Qué productos vendemos
✅ Zonas de cobertura
✅ Proceso general de compra
✅ Preguntas sobre categorías de productos

NO PUEDES (escalar a humano):
❌ Montos exactos de cuotas
❌ Tasas de interés específicas
❌ Promesas de aprobación
❌ Modificar políticas
❌ Quejas o reclamos

TONO: Natural, conversacional, como un amigo que ayuda. NO uses emojis excesivos. NO suenes robótico.
FORMATO: Respuestas cortas (2-3 líneas máximo). Siempre cierra preguntando qué producto le interesa.`;

export async function classifyIntent(
    message: string,
): Promise<"yes" | "no" | "question" | "unclear"> {
    try {
        const completion = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content:
                        `Clasifica la intención del mensaje del usuario en español.

REGLAS:
- "yes": Afirmaciones (sí, claro, ok, vale, dale, por supuesto, afirmativo, correcto, sep)
- "no": Negaciones (no, nada, no gracias, paso, negativo, para nada)
- "question": Preguntas (contiene ?, palabras interrogativas: qué/que/cuánto/como/donde/cuando, o pide información)
- "unclear": No se puede determinar o mensaje confuso

Responde SOLO con JSON: {"intent": "yes"|"no"|"question"|"unclear"}`,
                },
                { role: "user", content: message },
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
        });
        const choice = completion.choices[0];
        const content = choice?.message.content;
        const res = JSON.parse(content || "{}");
        return res.intent || "unclear";
    } catch {
        return "unclear";
    }
}

export async function extractEntity(
    message: string,
    entity: string,
    options?: { availableCategories?: string[] },
): Promise<string | null> {
    try {
        // Build dynamic prompt based on entity type
        let systemPrompt = `Extrae ${entity} del mensaje del usuario en español.`;
        
        if (entity === "product_category" && options?.availableCategories && options.availableCategories.length > 0) {
            const categoryList = options.availableCategories.map(c => `- ${c}`).join('\n');
            systemPrompt = `Extrae y normaliza la categoría de producto del mensaje del usuario.

CATEGORÍAS DISPONIBLES:
${categoryList}

Identifica qué categoría menciona el usuario (puede usar nombres de marcas, términos coloquiales, etc.).
Responde con la categoría exacta de la lista o null si no hay coincidencia.

Responde SOLO con JSON: {"value": "categoria_exacta"} o {"value": null}`;
        } else {
            systemPrompt += `\n\nResponde SOLO con JSON: {"value": string|null}`;
        }

        const completion = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: systemPrompt,
                },
                { role: "user", content: message },
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
        });
        const choice = completion.choices[0];
        const content = choice?.message.content;
        const res = JSON.parse(content || "{}");
        return res.value ? String(res.value) : null;
    } catch {
        return null;
    }
}

export async function answerQuestion(
    message: string,
    context: {
        segment?: string;
        creditLine?: number;
        state?: string;
    },
): Promise<{ answer: string; requiresHuman: boolean }> {
    try {
        const completion = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `${SALES_CONTEXT}

Contexto actual:
- Segmento: ${context.segment || "no determinado"}
- Línea de crédito: ${context.creditLine ? `S/ ${context.creditLine}` : "no determinada"}
- Estado: ${context.state || "conversación inicial"}

Responde la pregunta del cliente de forma natural y conversacional.
Si la pregunta requiere información financiera específica que no puedes dar, indica requiresHuman: true.

JSON: {"answer": "tu respuesta corta y natural", "requiresHuman": true|false}`,
                },
                { role: "user", content: message },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
        });

        const choice = completion.choices[0];
        const content = choice?.message.content;
        const res = JSON.parse(content || "{}");

        return {
            answer: res.answer || "Déjame conectarte con un asesor para responderte mejor.",
            requiresHuman: res.requiresHuman || false,
        };
    } catch {
        return {
            answer: "Déjame conectarte con un asesor para responderte mejor.",
            requiresHuman: true,
        };
    }
}

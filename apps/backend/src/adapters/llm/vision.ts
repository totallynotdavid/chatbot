import OpenAI from "openai";
import process from "node:process";

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const MODEL = "gemini-2.5-flash-lite";

function extractString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export type ExtractedProductData = {
  name: string | null;
  price: number | null;
  installments: number | null;
  category: string | null;
  description: string | null;
};

/**
 * Extract product data from main flyer image
 * Focuses on: name, price, installments, category
 */
async function extractFromMainFlyer(
  imageBuffer: Buffer,
): Promise<Partial<ExtractedProductData>> {
  try {
    const base64Image = imageBuffer.toString("base64");
    const mimeType = "image/jpeg";

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `Eres un asistente que extrae datos de productos desde flyers promocionales.

IMPORTANTE: Si hay MÚLTIPLES productos en la imagen, enfócate SOLO en el producto PRINCIPAL o MÁS PROMINENTE (generalmente el más grande o más destacado visualmente).

Extrae la siguiente información del producto principal:
- name: nombre completo del producto (marca y modelo)
- price: precio en soles (solo el número, sin "S/" ni comas)
- installments: número de cuotas mensuales (solo el número, puede estar indicado como "cuotas" o "meses")
- category: categoría del producto (Cocinas, Refrigeradoras, Smartphones, Laptops, TVs, etc.)

RETORNA UN OBJETO JSON (no un array) con exactamente estas 4 propiedades.
Si algún dato no está visible, usa null para ese campo.

Ejemplo de respuesta correcta:
{
  "name": "Samsung Galaxy S21",
  "price": 2999,
  "installments": 12,
  "category": "Smartphones"
}`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: "Extrae los datos del producto principal de este flyer.",
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return {};

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error(`[Vision] Failed to parse JSON in extractProductInfo:`, {
        error:
          parseError instanceof Error ? parseError.message : String(parseError),
        rawContent: content,
        contentPreview: content.substring(0, 300),
      });
      return {};
    }

    // Clean and validate extracted data
    return {
      name: extractString(parsed.name),
      price: parsed.price
        ? parseFloat(String(parsed.price).replace(/[,\s]/g, ""))
        : null,
      installments: parsed.installments
        ? parseInt(String(parsed.installments), 10)
        : null,
      category: extractString(parsed.category),
    };
  } catch (error) {
    console.error("Main flyer extraction error:", error);
    return {};
  }
}

/**
 * Extract technical specifications from specs flyer
 * Focuses on: description (technical details)
 */
async function extractFromSpecsFlyer(
  imageBuffer: Buffer,
): Promise<Partial<ExtractedProductData>> {
  try {
    const base64Image = imageBuffer.toString("base64");
    const mimeType = "image/jpeg";

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `Eres un asistente que extrae especificaciones técnicas desde flyers de productos.

Lee TODAS las especificaciones técnicas visibles en el flyer y organízalas en un texto descriptivo fluido.

Incluye:
- Dimensiones y peso
- Capacidad o tamaño de pantalla
- Características principales (procesador, memoria, almacenamiento, etc.)
- Tecnologías específicas
- Conectividad (WiFi, Bluetooth, puertos)
- Garantía
- Cualquier otro detalle técnico relevante

RETORNA UN OBJETO JSON con una única propiedad "description" que contenga el texto.
El texto debe ser claro, legible, sin encabezados ni bullets, solo párrafo(s) descriptivo(s).

Ejemplo de respuesta correcta:
{
  "description": "Televisor LED de 43 pulgadas con resolución Full HD 1920x1080. Cuenta con sistema operativo Android TV y procesador Quad Core. Incluye WiFi, Bluetooth y 3 puertos HDMI. Dimensiones: 97x56x8cm. Garantía de 1 año."
}`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: "Extrae todas las especificaciones técnicas visibles y organízalas en la descripción.",
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return {};

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error(`[Vision] Failed to parse JSON in extractSpecifications:`, {
        error:
          parseError instanceof Error ? parseError.message : String(parseError),
        rawContent: content,
        contentPreview: content.substring(0, 300),
      });
      return {};
    }

    return {
      description:
        extractString(parsed.description) ||
        extractString(parsed.specifications),
    };
  } catch (error) {
    console.error("Specs flyer extraction error:", error);
    return {};
  }
}

/**
 * Main extraction function
 * Processes main flyer (required) and specs flyer (optional)
 */
export async function extractProductData(
  mainImageBuffer: Buffer,
  specsImageBuffer?: Buffer,
): Promise<ExtractedProductData> {
  // Extract from main flyer
  const mainData = await extractFromMainFlyer(mainImageBuffer);

  // Wait a bit to avoid rate limits (sequential processing)
  if (specsImageBuffer) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Extract from specs flyer if provided
  let specsData = {};
  if (specsImageBuffer) {
    specsData = await extractFromSpecsFlyer(specsImageBuffer);
  }

  // Merge results
  return {
    name: mainData.name || null,
    price: mainData.price || null,
    installments: mainData.installments || null,
    category: mainData.category || null,
    description: (specsData as any).description || null,
  };
}

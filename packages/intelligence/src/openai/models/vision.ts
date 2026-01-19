import type { ProductData } from "../../types";
import { MODEL_CONFIG } from "../../config";
import { getVisionClient } from "../client";
import { parseLLMResponse, extractString } from "../shared";
import { MAIN_FLYER_PROMPT, SPECS_FLYER_PROMPT } from "../prompts/vision";

async function extractFromMainFlyer(
  imageBuffer: Buffer,
): Promise<Partial<ProductData>> {
  const client = getVisionClient();
  const baseConfig = MODEL_CONFIG.vision;
  const opConfig = baseConfig.extractProductData;

  const base64Image = imageBuffer.toString("base64");
  const mimeType = "image/jpeg";

  const completion = await client.chat.completions.create({
    model: baseConfig.model,
    ...(opConfig.temperature !== undefined && {
      temperature: opConfig.temperature,
    }),
    messages: [
      { role: "system", content: MAIN_FLYER_PROMPT },
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
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return {};

  const parsed = parseLLMResponse<Record<string, unknown>>(content, {});

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
}

async function extractFromSpecsFlyer(
  imageBuffer: Buffer,
): Promise<Partial<ProductData>> {
  const client = getVisionClient();
  const baseConfig = MODEL_CONFIG.vision;
  const opConfig = baseConfig.extractProductData;

  const base64Image = imageBuffer.toString("base64");
  const mimeType = "image/jpeg";

  const completion = await client.chat.completions.create({
    model: baseConfig.model,
    ...(opConfig.temperature !== undefined && {
      temperature: opConfig.temperature,
    }),
    messages: [
      { role: "system", content: SPECS_FLYER_PROMPT },
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
            text: "Extrae todas las especificaciones técnicas visibles.",
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return {};

  const parsed = parseLLMResponse<Record<string, unknown>>(content, {});

  return {
    description:
      extractString(parsed.description) || extractString(parsed.specifications),
  };
}

export async function extractProductData(
  mainImageBuffer: Buffer,
  specsImageBuffer?: Buffer,
): Promise<ProductData> {
  const mainData = await extractFromMainFlyer(mainImageBuffer);

  if (specsImageBuffer) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  let specsData: Partial<ProductData> = {};
  if (specsImageBuffer) {
    specsData = await extractFromSpecsFlyer(specsImageBuffer);
  }

  return {
    name: mainData.name || null,
    price: mainData.price || null,
    installments: mainData.installments || null,
    category: mainData.category || null,
    description: specsData.description || null,
  };
}

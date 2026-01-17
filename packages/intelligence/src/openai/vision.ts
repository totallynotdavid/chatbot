import OpenAI from "openai";
import type { ProductData } from "../types";
import { parseLLMResponse, extractString } from "./shared";
import { MAIN_FLYER_PROMPT, SPECS_FLYER_PROMPT } from "./prompts/vision";

const MODEL = "gemini-2.5-flash-lite";

async function extractFromMainFlyer(
  visionClient: OpenAI,
  imageBuffer: Buffer,
): Promise<Partial<ProductData>> {
  const base64Image = imageBuffer.toString("base64");
  const mimeType = "image/jpeg";

  const completion = await visionClient.chat.completions.create({
    model: MODEL,
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
    temperature: 0.1,
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
  visionClient: OpenAI,
  imageBuffer: Buffer,
): Promise<Partial<ProductData>> {
  const base64Image = imageBuffer.toString("base64");
  const mimeType = "image/jpeg";

  const completion = await visionClient.chat.completions.create({
    model: MODEL,
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
    temperature: 0.1,
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
  visionClient: OpenAI,
  mainImageBuffer: Buffer,
  specsImageBuffer?: Buffer,
): Promise<ProductData> {
  const mainData = await extractFromMainFlyer(visionClient, mainImageBuffer);

  if (specsImageBuffer) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  let specsData: Partial<ProductData> = {};
  if (specsImageBuffer) {
    specsData = await extractFromSpecsFlyer(visionClient, specsImageBuffer);
  }

  return {
    name: mainData.name || null,
    price: mainData.price || null,
    installments: mainData.installments || null,
    category: mainData.category || null,
    description: specsData.description || null,
  };
}

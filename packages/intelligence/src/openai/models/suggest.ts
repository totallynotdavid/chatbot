import { MODEL_CONFIG } from "../../config";
import { getTextClient } from "../client";
import { parseLLMResponse } from "../shared";
import { buildSuggestAlternativePrompt } from "@totem/core";

export async function suggestAlternative(
  requestedCategory: string,
  availableCategories: string[],
): Promise<string> {
  const client = getTextClient();
  const baseConfig = MODEL_CONFIG.generation;
  const opConfig = baseConfig.suggestAlternative;

  const completion = await client.chat.completions.create({
    model: baseConfig.model,
    ...(opConfig.temperature !== undefined && {
      temperature: opConfig.temperature,
    }),
    messages: [
      {
        role: "system",
        content: buildSuggestAlternativePrompt(
          requestedCategory,
          availableCategories,
        ),
      },
      {
        role: "user",
        content: `Cliente pidió: ${requestedCategory}. Categorías disponibles: ${availableCategories.join(", ")}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ suggestion?: string }>(content, {});

  return (
    res.suggestion ||
    `No tenemos ${requestedCategory} ahora. ¿Te gustaría ver ${availableCategories[0] || "otras opciones"}?`
  );
}

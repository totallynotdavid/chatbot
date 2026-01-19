import type { AnswerContext } from "../../types";
import { MODEL_CONFIG } from "../../config";
import { getTextClient } from "../client";
import { parseLLMResponse } from "../shared";
import { buildAnswerQuestionPrompt } from "@totem/core";

export async function answerQuestion(
  message: string,
  context: AnswerContext,
): Promise<string> {
  const client = getTextClient();
  const baseConfig = MODEL_CONFIG.generation;
  const opConfig = baseConfig.answerQuestion;

  const completion = await client.chat.completions.create({
    model: baseConfig.model,
    ...(opConfig.temperature !== undefined && {
      temperature: opConfig.temperature,
    }),
    messages: [
      { role: "system", content: buildAnswerQuestionPrompt(context) },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message.content;
  const result = parseLLMResponse<{ answer?: string }>(content, {});
  return result.answer || "Déjame ayudarte con eso.";
}

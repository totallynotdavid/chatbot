import { MODEL_CONFIG } from "../../config";
import { getTextClient } from "../client";
import { parseLLMResponse } from "../shared";
import { buildHandleBacklogPrompt } from "@totem/core";

export async function handleBacklogResponse(
  message: string,
  delayMinutes: number,
): Promise<string> {
  const client = getTextClient();
  const baseConfig = MODEL_CONFIG.generation;
  const opConfig = baseConfig.handleBacklog;

  const completion = await client.chat.completions.create({
    model: baseConfig.model,
    ...(opConfig.temperature !== undefined && {
      temperature: opConfig.temperature,
    }),
    messages: [
      {
        role: "system",
        content: buildHandleBacklogPrompt(message, delayMinutes),
      },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ apology?: string }>(content, {});

  return res.apology || "Disculpa la demora, recién vi tu mensaje.";
}

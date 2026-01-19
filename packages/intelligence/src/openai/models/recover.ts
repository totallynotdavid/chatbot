import type { RecoveryContext } from "../../types";
import { MODEL_CONFIG } from "../../config";
import { getTextClient } from "../client";
import { parseLLMResponse } from "../shared";
import { buildRecoverUnclearPrompt } from "@totem/core";

export async function recoverUnclearResponse(
  message: string,
  context: RecoveryContext,
): Promise<string> {
  const client = getTextClient();
  const baseConfig = MODEL_CONFIG.generation;
  const opConfig = baseConfig.recoverUnclear;

  const completion = await client.chat.completions.create({
    model: baseConfig.model,
    ...(opConfig.temperature !== undefined && {
      temperature: opConfig.temperature,
    }),
    messages: [
      { role: "system", content: buildRecoverUnclearPrompt(context) },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ recovery?: string }>(content, {
    recovery: "Disculpa, no te entendí. ¿Puedes repetirlo?",
  });

  return res.recovery || "Disculpa, no te entendí. ¿Puedes repetirlo?";
}

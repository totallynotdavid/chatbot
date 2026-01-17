import OpenAI from "openai";
import type { AnswerContext, RecoveryContext } from "../types";
import {
  buildAnswerQuestionPrompt,
  buildSuggestAlternativePrompt,
  buildHandleBacklogPrompt,
  buildRecoverUnclearPrompt,
} from "@totem/core";
import { parseLLMResponse } from "./shared";

const MODEL = "gpt-5-nano-2025-08-07";

export async function answerQuestion(
  client: OpenAI,
  message: string,
  context: AnswerContext,
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: buildAnswerQuestionPrompt(context) },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0]?.message.content;
  const result = parseLLMResponse<{ answer?: string }>(content, {});
  return result.answer || "Déjame ayudarte con eso.";
}

export async function suggestAlternative(
  client: OpenAI,
  requestedCategory: string,
  availableCategories: string[],
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: MODEL,
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
    temperature: 0.8,
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ suggestion?: string }>(content, {});

  return (
    res.suggestion ||
    `No tenemos ${requestedCategory} ahora. ¿Te gustaría ver ${availableCategories[0] || "otras opciones"}?`
  );
}

export async function recoverUnclearResponse(
  client: OpenAI,
  message: string,
  context: RecoveryContext,
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: buildRecoverUnclearPrompt(context) },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
    temperature: 0.9,
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ recovery?: string }>(content, {
    recovery: "Disculpa, no te entendí. ¿Puedes repetirlo?",
  });

  return res.recovery || "Disculpa, no te entendí. ¿Puedes repetirlo?";
}

export async function handleBacklogResponse(
  client: OpenAI,
  message: string,
  delayMinutes: number,
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: buildHandleBacklogPrompt(message, delayMinutes),
      },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
    temperature: 0.8,
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ apology?: string }>(content, {});

  return res.apology || "Disculpa la demora, recién vi tu mensaje.";
}

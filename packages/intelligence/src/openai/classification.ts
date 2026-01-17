import OpenAI from "openai";
import {
  buildIsQuestionPrompt,
  buildIsProductRequestPrompt,
  buildShouldEscalatePrompt,
} from "@totem/core";
import { parseLLMResponse } from "./shared";

const MODEL = "gpt-5-nano-2025-08-07";

export async function isQuestion(
  client: OpenAI,
  message: string,
): Promise<boolean> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: buildIsQuestionPrompt() },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ isQuestion?: boolean }>(content, {});
  return res.isQuestion === true;
}

export async function shouldEscalate(
  client: OpenAI,
  message: string,
): Promise<boolean> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: buildShouldEscalatePrompt() },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ shouldEscalate?: boolean }>(content, {});
  return res.shouldEscalate === true;
}

export async function isProductRequest(
  client: OpenAI,
  message: string,
): Promise<boolean> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: buildIsProductRequestPrompt() },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ isProductRequest?: boolean }>(content, {});
  return res.isProductRequest === true;
}

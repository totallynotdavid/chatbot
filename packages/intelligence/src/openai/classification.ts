import {
  buildIsQuestionPrompt,
  buildIsProductRequestPrompt,
  buildShouldEscalatePrompt,
} from "@totem/core";
import { MODEL_CONFIG } from "../config";
import { getTextClient } from "./client";
import { parseLLMResponse } from "./shared";

export async function isQuestion(message: string): Promise<boolean> {
  const client = getTextClient();
  const baseConfig = MODEL_CONFIG.classification;
  const opConfig = baseConfig.isQuestion;

  const completion = await client.chat.completions.create({
    model: baseConfig.model,
    ...(opConfig.temperature !== undefined && {
      temperature: opConfig.temperature,
    }),
    messages: [
      { role: "system", content: buildIsQuestionPrompt() },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ isQuestion?: boolean }>(content, {});
  return res.isQuestion === true;
}

export async function shouldEscalate(message: string): Promise<boolean> {
  const client = getTextClient();
  const baseConfig = MODEL_CONFIG.classification;
  const opConfig = baseConfig.shouldEscalate;

  const completion = await client.chat.completions.create({
    model: baseConfig.model,
    ...(opConfig.temperature !== undefined && {
      temperature: opConfig.temperature,
    }),
    messages: [
      { role: "system", content: buildShouldEscalatePrompt() },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ shouldEscalate?: boolean }>(content, {});
  return res.shouldEscalate === true;
}

export async function isProductRequest(message: string): Promise<boolean> {
  const client = getTextClient();
  const baseConfig = MODEL_CONFIG.classification;
  const opConfig = baseConfig.isProductRequest;

  const completion = await client.chat.completions.create({
    model: baseConfig.model,
    ...(opConfig.temperature !== undefined && {
      temperature: opConfig.temperature,
    }),
    messages: [
      { role: "system", content: buildIsProductRequestPrompt() },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{ isProductRequest?: boolean }>(content, {});
  return res.isProductRequest === true;
}

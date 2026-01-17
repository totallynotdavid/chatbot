import OpenAI from "openai";

export function parseLLMResponse<T = Record<string, unknown>>(
  content: string | null | undefined,
  defaultValue: T,
): T {
  if (!content) {
    return defaultValue;
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    return defaultValue;
  }
}

export function extractString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function createTextClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export function createVisionClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });
}

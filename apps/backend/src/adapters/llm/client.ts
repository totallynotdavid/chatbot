import OpenAI from "openai";
import process from "node:process";

export const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

export const MODEL = "gemini-2.5-flash-lite";

export function parseLLMResponse<T = Record<string, unknown>>(
  content: string | null | undefined,
  context: string,
  defaultValue: T,
): T {
  if (!content) {
    console.error(`[LLM] Empty response from ${context}`);
    return defaultValue;
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    console.error(`[LLM] Failed to parse JSON from ${context}:`, {
      error: error instanceof Error ? error.message : String(error),
      rawContent: content,
      contentPreview: content.substring(0, 300),
      contentLength: content.length,
    });
    return defaultValue;
  }
}

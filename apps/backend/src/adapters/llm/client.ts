import OpenAI from "openai";
import process from "node:process";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("llm");

export const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const MODEL = "gpt-5-nano-2025-08-07";

export function parseLLMResponse<T = Record<string, unknown>>(
  content: string | null | undefined,
  context: string,
  defaultValue: T,
): T {
  if (!content) {
    logger.error({ context }, "Empty LLM response");
    return defaultValue;
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        context,
        contentPreview: content.substring(0, 300),
        contentLength: content.length,
      },
      "Failed to parse LLM JSON response",
    );
    return defaultValue;
  }
}

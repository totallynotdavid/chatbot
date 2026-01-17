import OpenAI from "openai";
import type { Bundle } from "@totem/types";
import type { IntentResult } from "../types";
import { buildExtractBundleIntentPrompt } from "@totem/core";
import { parseLLMResponse } from "./shared";

const MODEL = "gpt-5-nano-2025-08-07";

export async function extractBundleIntent(
  client: OpenAI,
  message: string,
  affordableBundles: Bundle[],
): Promise<IntentResult> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: buildExtractBundleIntentPrompt(affordableBundles),
      },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message.content;
  const res = parseLLMResponse<{
    bundleIndex?: number;
    confidence?: number;
  }>(content, {});

  const bundleIndex = res.bundleIndex;
  if (
    bundleIndex !== null &&
    bundleIndex !== undefined &&
    bundleIndex >= 1 &&
    bundleIndex <= affordableBundles.length
  ) {
    const bundle = affordableBundles[bundleIndex - 1];
    return {
      bundle: bundle || null,
      confidence: res.confidence || 0,
    };
  }

  return { bundle: null, confidence: res.confidence || 0 };
}

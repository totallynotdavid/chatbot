import type { Bundle } from "@totem/types";
import type { IntentResult } from "../types";
import { buildExtractBundleIntentPrompt } from "@totem/core";
import { MODEL_CONFIG } from "../config";
import { getTextClient } from "./client";
import { parseLLMResponse } from "./shared";

export async function extractBundleIntent(
  message: string,
  affordableBundles: Bundle[],
): Promise<IntentResult> {
  const client = getTextClient();
  const baseConfig = MODEL_CONFIG.extraction;
  const opConfig = baseConfig.bundleIntent;

  const completion = await client.chat.completions.create({
    model: baseConfig.model,
    ...(opConfig.temperature !== undefined && {
      temperature: opConfig.temperature,
    }),
    messages: [
      {
        role: "system",
        content: buildExtractBundleIntentPrompt(affordableBundles),
      },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
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

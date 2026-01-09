/**
 * The approach:
 * 1. Classify question type
 * 2. Retrieve type-specific context
 * 3. Generate focused answer
 */

import {
  buildClassifyQuestionPrompt,
  buildWarrantyAnswerPrompt,
  buildDeliveryAnswerPrompt,
  buildContractAnswerPrompt,
  buildPaymentAnswerPrompt,
  buildReturnsAnswerPrompt,
  buildCoverageAnswerPrompt,
  buildProductAnswerPrompt,
  BUSINESS_FACTS,
  type QuestionType,
} from "@totem/core";
import { client, MODEL, parseLLMResponse } from "./client.ts";
import { classifyLLMError } from "./types.ts";
import { logLLMError } from "./error-logger.ts";
import { BundleService } from "../../domains/catalog/bundles.ts";
import { CATEGORIES } from "@totem/types";

type AnswerContext = {
  segment?: string;
  creditLine?: number;
  phase: string;
  availableCategories: string[];
};

async function classifyQuestion(
  message: string,
  phoneNumber: string,
): Promise<QuestionType> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: buildClassifyQuestionPrompt() },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const content = completion.choices[0]?.message.content;
    const result = parseLLMResponse<{ type?: string }>(
      content,
      "classifyQuestion",
      {},
    );
    return (result.type as QuestionType) || "general";
  } catch (error) {
    logLLMError(phoneNumber, "classifyQuestion", classifyLLMError(error));
    return "general";
  }
}

export async function answerQuestionFocused(
  message: string,
  context: AnswerContext,
  phoneNumber: string,
): Promise<string> {
  try {
    // Classify question
    const questionType = await classifyQuestion(message, phoneNumber);

    console.log(
      `[LLM] Question type: ${questionType} for message: "${message}"`,
    );

    // Retrieve context and generate answer based on type
    switch (questionType) {
      case "warranty":
        return await answerWithPrompt(
          message,
          buildWarrantyAnswerPrompt(BUSINESS_FACTS.warranty),
        );

      case "delivery":
        return await answerWithPrompt(
          message,
          buildDeliveryAnswerPrompt(BUSINESS_FACTS.delivery),
        );

      case "contract":
        return await answerWithPrompt(
          message,
          buildContractAnswerPrompt(BUSINESS_FACTS.contract),
        );

      case "payment":
        return await answerWithPrompt(
          message,
          buildPaymentAnswerPrompt(BUSINESS_FACTS.payment, context.creditLine),
        );

      case "returns":
        return await answerWithPrompt(
          message,
          buildReturnsAnswerPrompt(BUSINESS_FACTS.returns),
        );

      case "coverage":
        return await answerWithPrompt(
          message,
          buildCoverageAnswerPrompt(BUSINESS_FACTS.coverage),
        );

      case "product_inquiry":
      case "price_inquiry":
      case "product_specs":
        return await answerProductQuestion(message, context);

      case "general":
      default:
        // Fallback: answer with general context
        return await answerWithPrompt(message, buildGeneralPrompt(context));
    }
  } catch (error) {
    console.error("[LLM] Question answering failed:", error);
    logLLMError(
      phoneNumber,
      "answerQuestionFocused",
      classifyLLMError(error),
      context.phase,
    );
    return "Déjame ayudarte con eso. ¿Podrías ser más específico?";
  }
}

async function answerProductQuestion(
  message: string,
  context: AnswerContext,
): Promise<string> {
  try {
    // Detect category from message
    const detectedCategory = detectCategoryFromMessage(
      message,
      context.availableCategories,
    );

    // Query available products
    const bundles = await BundleService.getAvailable({
      segment: context.segment as "fnb" | "gaso",
      category: detectedCategory,
      maxPrice: context.creditLine,
    });

    const products = bundles.map((b) => ({
      name: b.name,
      price: b.price,
      category: b.primary_category,
    }));

    return await answerWithPrompt(
      message,
      buildProductAnswerPrompt(products, detectedCategory),
    );
  } catch (error) {
    console.error("[LLM] Product question failed:", error);
    return "Déjame revisar qué productos tenemos disponibles para ti.";
  }
}

async function answerWithPrompt(
  message: string,
  systemPrompt: string,
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0]?.message.content;
  const result = parseLLMResponse<{ answer?: string }>(
    content,
    "answerWithPrompt",
    {},
  );
  return result.answer || "Déjame ayudarte con eso.";
}

function buildGeneralPrompt(context: AnswerContext): string {
  const creditInfo = context.creditLine
    ? `Línea de crédito: S/ ${context.creditLine}`
    : "";

  return `You are a sales agent for Totem. Answer the customer's question naturally.

Context:
- Segment: ${context.segment || "N/A"}
- ${creditInfo}
- Categories: ${context.availableCategories.join(", ")}

Keep answer brief (2-3 lines). If unsure, say "Un agente te podrá ayudar mejor con esa información."

JSON: {"answer": "your response"}`;
}

function detectCategoryFromMessage(
  message: string,
  availableCategories: string[],
): string | undefined {
  const normalized = message.toLowerCase();

  for (const category of availableCategories) {
    const config = CATEGORIES[category as keyof typeof CATEGORIES];
    if (!config) continue;

    const allKeywords = [
      config.key,
      config.display,
      ...config.aliases,
      ...config.brands,
    ];

    if (allKeywords.some((kw) => normalized.includes(kw.toLowerCase()))) {
      return category;
    }
  }

  return undefined;
}

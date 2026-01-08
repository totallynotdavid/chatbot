import OpenAI from "openai";
import process from "node:process";
import {
  buildClassifyIntentPrompt,
  buildIsQuestionPrompt,
  buildExtractEntityPrompt,
  buildAnswerQuestionPrompt,
  buildSuggestAlternativePrompt,
  buildHandleBacklogPrompt,
} from "@totem/core";

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const MODEL = "gemini-2.5-flash-lite";

/**
 * Simple binary check: is this message a question?
 * More focused than classifyIntent, faster and more accurate.
 */
export async function isQuestion(message: string): Promise<boolean> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: buildIsQuestionPrompt() },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const choice = completion.choices[0];
    const content = choice?.message.content;
    const res = JSON.parse(content || "{}");
    return res.isQuestion === true;
  } catch (e) {
    console.error("[isQuestion error]", e);
    return false;
  }
}

/**
 * @deprecated Use isQuestion for new code
 */
export async function classifyIntent(
  message: string,
): Promise<"yes" | "no" | "question" | "product_selection" | "unclear"> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: buildClassifyIntentPrompt(),
        },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    const choice = completion.choices[0];
    const content = choice?.message.content;
    const res = JSON.parse(content || "{}");
    return res.intent || "unclear";
  } catch {
    return "unclear";
  }
}

export async function extractEntity(
  message: string,
  entity: string,
  options?: { availableCategories?: string[] },
): Promise<string | null> {
  try {
    const systemPrompt = buildExtractEntityPrompt(entity, options?.availableCategories);

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    const choice = completion.choices[0];
    const content = choice?.message.content;
    const res = JSON.parse(content || "{}");
    return res.category ?? res.value ?? null;
  } catch {
    return null;
  }
}

export async function answerQuestion(
  message: string,
  context: {
    segment?: string;
    creditLine?: number;
    state?: string;
  },
): Promise<{ answer: string; requiresHuman: boolean }> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: buildAnswerQuestionPrompt(context),
        },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const choice = completion.choices[0];
    const content = choice?.message.content;
    const res = JSON.parse(content || "{}");

    return {
      answer:
        res.answer || "Déjame conectarte con un asesor para responderte mejor.",
      requiresHuman: res.requiresHuman || false,
    };
  } catch {
    return {
      answer: "Déjame conectarte con un asesor para responderte mejor.",
      requiresHuman: true,
    };
  }
}

export async function suggestAlternative(
  requestedCategory: string,
  availableCategories: string[],
): Promise<string> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: buildSuggestAlternativePrompt(requestedCategory, availableCategories),
        },
        {
          role: "user",
          content: `Cliente pidió: ${requestedCategory}. Categorías disponibles: ${availableCategories.join(", ")}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
    });

    const choice = completion.choices[0];
    const content = choice?.message.content;
    const res = JSON.parse(content || "{}");

    return (
      res.suggestion ||
      `No tenemos ${requestedCategory} ahora. ¿Te gustaría ver ${availableCategories[0] || "otras opciones"}?`
    );
  } catch {
    return `No tenemos ${requestedCategory} disponible ahorita. ¿Te interesa algo más?`;
  }
}

export async function handleBacklogResponse(
  message: string,
  ageMinutes: number,
): Promise<string> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: buildHandleBacklogPrompt(message, ageMinutes),
        },
        {
          role: "user",
          content: `Mensaje del cliente hace ${ageMinutes} minutos: "${message}"`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
    });

    const choice = completion.choices[0];
    const content = choice?.message.content;
    const res = JSON.parse(content || "{}");

    return res.response || `¡Hola! Disculpa la demora. ¿En qué puedo ayudarte?`;
  } catch {
    return `¡Hola! Disculpa la demora. ¿En qué puedo ayudarte?`;
  }
}

import {
  buildIsQuestionPrompt,
  buildExtractCategoryPrompt,
  buildShouldEscalatePrompt,
  buildAnswerQuestionPrompt,
  buildSuggestAlternativePrompt,
  buildHandleBacklogPrompt,
  getCategoryMetadata,
} from "@totem/core";
import { client, MODEL, parseLLMResponse } from "./client.ts";
import { classifyLLMError } from "./types.ts";
import { logLLMError } from "./error-logger.ts";

export async function isQuestion(
  message: string,
  phoneNumber: string,
  state?: string,
): Promise<boolean> {
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
    const res = parseLLMResponse<{ isQuestion?: boolean }>(
      content,
      "isQuestion",
      {},
    );
    return res.isQuestion === true;
  } catch (e) {
    logLLMError(phoneNumber, "isQuestion", classifyLLMError(e), state);
    return false;
  }
}

export async function shouldEscalate(
  message: string,
  phoneNumber: string,
  state?: string,
): Promise<boolean> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: buildShouldEscalatePrompt() },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const choice = completion.choices[0];
    const content = choice?.message.content;
    const res = parseLLMResponse<{ shouldEscalate?: boolean }>(
      content,
      "shouldEscalate",
      {},
    );
    return res.shouldEscalate === true;
  } catch (e) {
    logLLMError(phoneNumber, "shouldEscalate", classifyLLMError(e), state);
    return false;
  }
}

export async function extractCategory(
  message: string,
  availableCategories: string[],
  phoneNumber: string,
  state?: string,
): Promise<string | null> {
  try {
    const metadata = getCategoryMetadata(availableCategories);

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: buildExtractCategoryPrompt(metadata),
        },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    const choice = completion.choices[0];
    const content = choice?.message.content;
    const res = parseLLMResponse<{ category?: string }>(
      content,
      "extractCategory",
      {},
    );
    return res.category ?? null;
  } catch (e) {
    logLLMError(phoneNumber, "extractCategory", classifyLLMError(e), state, {
      availableCategories,
    });
    return null;
  }
}

export async function answerQuestion(
  message: string,
  context: {
    segment?: string;
    creditLine?: number;
    state?: string;
    availableCategories?: string[];
  },
  phoneNumber: string,
): Promise<string> {
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
    const res = parseLLMResponse<{ answer?: string }>(
      content,
      "answerQuestion",
      {},
    );

    return res.answer || "Déjame ayudarte con eso...";
  } catch (e) {
    logLLMError(
      phoneNumber,
      "answerQuestion",
      classifyLLMError(e),
      context.state,
      {
        segment: context.segment,
        creditLine: context.creditLine,
      },
    );
    return "Déjame ayudarte con eso...";
  }
}

export async function suggestAlternative(
  requestedCategory: string,
  availableCategories: string[],
  phoneNumber: string,
): Promise<string> {
  try {
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

    const choice = completion.choices[0];
    const content = choice?.message.content;
    const res = parseLLMResponse<{ suggestion?: string }>(
      content,
      "suggestAlternative",
      {},
    );

    return (
      res.suggestion ||
      `No tenemos ${requestedCategory} ahora. ¿Te gustaría ver ${availableCategories[0] || "otras opciones"}?`
    );
  } catch (e) {
    logLLMError(
      phoneNumber,
      "suggestAlternative",
      classifyLLMError(e),
      undefined,
      {
        requestedCategory,
        availableCategories,
      },
    );
    return `No tenemos ${requestedCategory} disponible ahorita. ¿Te interesa algo más?`;
  }
}

export async function handleBacklogResponse(
  message: string,
  ageMinutes: number,
  phoneNumber: string,
  state?: string,
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
    const res = parseLLMResponse<{ response?: string }>(
      content,
      "handleBacklogResponse",
      {},
    );

    return res.response || `¡Hola! Disculpa la demora. ¿En qué puedo ayudarte?`;
  } catch (e) {
    logLLMError(
      phoneNumber,
      "handleBacklogResponse",
      classifyLLMError(e),
      state,
      {
        ageMinutes,
      },
    );
    return `¡Hola! Disculpa la demora. ¿En qué puedo ayudarte?`;
  }
}

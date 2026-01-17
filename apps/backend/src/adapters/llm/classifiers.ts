import {
  buildIsQuestionPrompt,
  buildExtractCategoryPrompt,
  buildShouldEscalatePrompt,
  buildAnswerQuestionPrompt,
  buildSuggestAlternativePrompt,
  buildHandleBacklogPrompt,
  buildRecoverUnclearPrompt,
  getCategoryMetadata,
} from "@totem/core";
import { client, MODEL, parseLLMResponse } from "./client.ts";
import { classifyLLMError } from "./types.ts";
import { logLLMError } from "./error-logger.ts";

export async function recoverUnclearResponse(
  message: string,
  context: {
    phase: string;
    lastQuestion?: string;
    expectedOptions?: string[];
  },
  phoneNumber: string,
): Promise<string> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: buildRecoverUnclearPrompt(context) },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.9,
    });

    const content = completion.choices[0]?.message.content;
    const res = parseLLMResponse<{ recovery: string }>(
      content,
      "recoverUnclearResponse",
      { recovery: "Disculpa, no te entendí. ¿Puedes repetirlo?" },
    );

    return res.recovery;
  } catch (e) {
    logLLMError(
      phoneNumber,
      "recoverUnclearResponse",
      classifyLLMError(e),
      context.phase,
    );
    return "Disculpa, no entendí bien. ¿Podrías decirme de nuevo?";
  }
}

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
  taxonomy: string[],
  phoneNumber: string,
  state?: string,
): Promise<{ category: string | null; requestedProduct?: string }> {
  try {
    const metadata = getCategoryMetadata(taxonomy);

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: buildExtractCategoryPrompt(metadata, availableCategories),
        },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    const choice = completion.choices[0];
    const content = choice?.message.content;
    const res = parseLLMResponse<{
      category?: string;
      requestedProduct?: string;
    }>(content, "extractCategory", {});
    return {
      category: res.category ?? null,
      requestedProduct: res.requestedProduct,
    };
  } catch (e) {
    logLLMError(phoneNumber, "extractCategory", classifyLLMError(e), state, {
      availableCategories,
    });
    return { category: null };
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

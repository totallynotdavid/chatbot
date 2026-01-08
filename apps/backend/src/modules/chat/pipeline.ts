import { transition, matchCategory } from "@totem/core";
import type { Conversation } from "@totem/types";
import type { Command } from "@totem/core";
import {
  getOrCreateConversation,
  updateConversationState,
  buildStateContext,
  checkSessionTimeout,
  resetSession,
} from "./context.ts";
import * as LLM from "../llm/index.ts";
import { BundleService } from "../../services/catalog/index.ts";

export type PipelineOutput = {
  commands: Command[];
  shouldAssignAgent: boolean;
};

export async function processMessagePipeline(
  phoneNumber: string,
  message: string,
  metadata?: { isBacklog: boolean; oldestMessageAge: number },
): Promise<PipelineOutput> {
  const conv = getOrCreateConversation(phoneNumber);

  if (conv.current_state === "CLOSING" || conv.current_state === "ESCALATED") {
    resetSession(phoneNumber);
    const resetConv = getOrCreateConversation(phoneNumber);
    return await executeTransition(resetConv, message, metadata);
  }

  if (checkSessionTimeout(conv) && conv.current_state !== "INIT") {
    resetSession(phoneNumber);
    const resetConv = getOrCreateConversation(phoneNumber);
    return await executeTransition(resetConv, message, metadata);
  }

  return await executeTransition(conv, message, metadata);
}

async function executeTransition(
  conv: Conversation,
  message: string,
  metadata?: { isBacklog: boolean; oldestMessageAge: number },
): Promise<PipelineOutput> {
  const context = buildStateContext(conv);
  const state = conv.current_state;

  let backlogResponse: string | null = null;
  if (metadata?.isBacklog && state === "INIT") {
    const ageMinutes = Math.floor(metadata.oldestMessageAge / 60000);
    backlogResponse = await LLM.handleBacklogResponse(
      message,
      ageMinutes,
      conv.phone_number,
      state,
    );
  }

  if (state !== "INIT" && state !== "WAITING_PROVIDER") {
    const isQuestionResult = await LLM.isQuestion(
      message,
      conv.phone_number,
      state,
    );

    if (isQuestionResult) {
      const shouldEscalate = await LLM.shouldEscalate(
        message,
        conv.phone_number,
        state,
      );

      if (shouldEscalate) {
        context.llmDetectedQuestion = true;
        context.llmRequiresHuman = true;
      } else {
        const availableCategories =
          context.segment === "fnb"
            ? BundleService.getAvailableCategories("fnb")
            : BundleService.getAvailableCategories("gaso");

        const answer = await LLM.answerQuestion(
          message,
          {
            segment: context.segment,
            creditLine: context.creditLine,
            state,
            availableCategories,
          },
          conv.phone_number,
        );

        context.llmDetectedQuestion = true;
        context.llmGeneratedAnswer = answer;
        context.llmRequiresHuman = false;
      }
    }
  }

  if (state === "OFFER_PRODUCTS") {
    const matchedCategory = matchCategory(message);

    if (matchedCategory) {
      context.extractedCategory = matchedCategory;
      context.usedLLM = false;
    } else {
      const availableCategories =
        context.segment === "fnb"
          ? BundleService.getAvailableCategories("fnb")
          : BundleService.getAvailableCategories("gaso");

      const category = await LLM.extractCategory(
        message,
        availableCategories,
        conv.phone_number,
        state,
      );

      if (category) {
        context.extractedCategory = category;
        context.usedLLM = true;
      }
    }
  }

  const output = transition({
    currentState: conv.current_state,
    message,
    context,
  });

  updateConversationState(
    conv.phone_number,
    output.nextState,
    output.updatedContext,
  );

  const shouldAssignAgent =
    (output.updatedContext.purchaseConfirmed ?? false) && !conv.is_simulation;

  let commands = output.commands;
  if (backlogResponse) {
    commands = [
      { type: "SEND_MESSAGE", content: backlogResponse },
      ...output.commands,
    ];
  }

  return {
    commands,
    shouldAssignAgent,
  };
}

import { withLock } from "../locks.ts";
import {
  getOrCreateConversation,
  isSessionTimedOut,
  resetSession,
} from "../store.ts";
import { runEnrichmentLoop } from "./enrichment-loop.ts";
import { executeCommands } from "./command-executor.ts";
import { calculateResponseDelay } from "./response-timing.ts";
import { sleep } from "./sleep.ts";
import { createLogger } from "../../lib/logger.ts";

import type { QuotedMessageContext } from "@totem/types";
import { WhatsAppService } from "../../adapters/whatsapp/index.ts";
import { getProvider } from "@totem/intelligence";
import { eventBus, createEvent } from "../../shared/events/index.ts";

const logger = createLogger("conversation");

export type IncomingMessage = {
  phoneNumber: string;
  content: string;
  timestamp: number;
  messageId: string;
  quotedContext?: QuotedMessageContext;
};

export async function handleMessage(message: IncomingMessage): Promise<void> {
  const { phoneNumber, content, timestamp, messageId, quotedContext } = message;

  await withLock(phoneNumber, async () => {
    logger.debug(
      { phoneNumber, messageId, hasQuoted: !!quotedContext },
      "Processing message",
    );

    const conversation = getOrCreateConversation(phoneNumber);

    if (isSessionTimedOut(conversation.metadata)) {
      logger.info(
        { phoneNumber, lastCategory: conversation.metadata.lastCategory },
        "Session timeout reset",
      );
      resetSession(phoneNumber, conversation.metadata.lastCategory);
    }

    const traceId = crypto.randomUUID();

    await WhatsAppService.markAsReadAndShowTyping(messageId);

    try {
      const provider = getProvider();

      const result = await runEnrichmentLoop(
        conversation.phase,
        content,
        conversation.metadata,
        phoneNumber,
        provider,
        quotedContext,
      );

      if (result.events && result.events.length > 0) {
        for (const event of result.events) {
          await eventBus.emit({ ...event, traceId });
        }
      }

      if (result.type === "update" && result.nextPhase.phase === "escalated") {
        eventBus.emit(
          createEvent(
            "escalation_triggered",
            {
              phoneNumber,
              reason: result.nextPhase.reason,
              context: {
                phase: conversation.phase.phase,
                message: content,
              },
            },
            { traceId },
          ),
        );
      }

      const delay = calculateResponseDelay(timestamp, Date.now());
      if (delay > 0) {
        await sleep(delay);
      }

      await executeCommands(
        result,
        phoneNumber,
        conversation.metadata,
        conversation.isSimulation,
        traceId,
      );
    } catch (error) {
      logger.error(
        {
          error,
          phoneNumber,
          messageId,
          phase: conversation.phase.phase,
          traceId,
        },
        "Message processing failed",
      );

      eventBus.emit(
        createEvent(
          "system_error_occurred",
          {
            phoneNumber,
            error: "Error processing message",
            context: {
              error: error instanceof Error ? error.message : String(error),
              phase: conversation.phase.phase,
            },
          },
          { traceId },
        ),
      );
    }
  });
}

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
import { notifyTeam } from "../../adapters/notifier/client.ts";
import type { QuotedMessageContext } from "@totem/types";
import { WhatsAppService } from "../../adapters/whatsapp/index.ts";
import { getProvider } from "@totem/intelligence";

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

    let conversation = getOrCreateConversation(phoneNumber);

    if (isSessionTimedOut(conversation.metadata)) {
      logger.info(
        { phoneNumber, lastCategory: conversation.metadata.lastCategory },
        "Session timeout reset",
      );
      resetSession(phoneNumber, conversation.metadata.lastCategory);
      conversation = getOrCreateConversation(phoneNumber);
      conversation.metadata.isReturningUser = true;
    }

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

      const delay = calculateResponseDelay(timestamp, Date.now());
      if (delay > 0) {
        await sleep(delay);
      }

      await executeCommands(
        result,
        phoneNumber,
        conversation.metadata,
        conversation.isSimulation,
      );
    } catch (error) {
      logger.error(
        { error, phoneNumber, messageId, phase: conversation.phase.phase },
        "Message processing failed",
      );

      await notifyTeam(
        "dev",
        `CRITICAL: Message processing failed for ${phoneNumber}\nPhase: ${conversation.phase.phase}\nError: ${error instanceof Error ? error.message : String(error)}`,
      ).catch(() => {});
    }
  });
}

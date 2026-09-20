import { getProvider } from "@totem/intelligence";
import type { ConversationRef, QuotedMessageContext } from "@totem/types";
import {
  ChannelUnavailableError,
  WhatsAppService,
} from "../../adapters/whatsapp/index.ts";
import { ProductService } from "../../domains/catalog/products.ts";
import { createLogger } from "../../lib/logger.ts";
import { createEvent, eventBus } from "../../shared/events/index.ts";
import { withLock } from "../locks.ts";
import {
  getOrCreateConversation,
  isSessionTimedOut,
  resetSession,
} from "../store.ts";
import { executeCommands } from "./command-executor.ts";
import { runEnrichmentLoop } from "./enrichment-loop.ts";
import { calculateResponseDelay } from "./response-timing.ts";
import { sleep } from "./sleep.ts";

const logger = createLogger("conversation");

export type IncomingMessage = {
  /** Which tenant, which of its numbers, and the contact writing in. */
  ref: ConversationRef;
  content: string;
  timestamp: number;
  messageId: string;
  quotedContext?: QuotedMessageContext;
};

export async function handleMessage(message: IncomingMessage): Promise<void> {
  const { ref, content, timestamp, messageId, quotedContext } = message;
  const { tenantId, channelAccountId, phoneNumber } = ref;

  await withLock(ref, async () => {
    logger.debug(
      { tenantId, phoneNumber, messageId, hasQuoted: !!quotedContext },
      "Processing message",
    );

    let conversation = getOrCreateConversation(ref);

    if (isSessionTimedOut(conversation.metadata)) {
      logger.info(
        {
          tenantId,
          phoneNumber,
          lastCategory: conversation.metadata.lastCategory,
        },
        "Session timeout reset",
      );
      resetSession(ref, conversation.metadata.lastCategory);
      // This turn answers from the reset conversation. The old phase would
      // be written back over the reset when the turn ends.
      conversation = getOrCreateConversation(ref);
    }

    const traceId = crypto.randomUUID();
    const eventContext = { traceId, tenantId, channelAccountId };

    await WhatsAppService.markAsReadAndShowTyping(ref, messageId);

    try {
      const provider = getProvider();

      const catalogContext = {
        activeBrands: ProductService.getActiveBrands(tenantId),
        activeCategories: ProductService.getCategories(tenantId),
      };

      const result = await runEnrichmentLoop(
        conversation.phase,
        content,
        conversation.metadata,
        ref,
        provider,
        quotedContext,
        catalogContext,
      );

      const delay = calculateResponseDelay(timestamp, Date.now());
      if (delay > 0) {
        await sleep(delay);
      }

      await executeCommands(
        result,
        ref,
        conversation.metadata,
        conversation.isSimulation,
        traceId,
      );

      // The transition's events go out after its replies, for the reason
      // `executeCommands` persists the phase after them: a send that throws
      // puts this message back on its queue to be answered again from the
      // same phase, and anything emitted before that point is emitted twice.
      // `purchase_confirmed` creates an order, so emitted first it turned one
      // number switched off mid-confirmation into two orders for one sale.
      if (result.events && result.events.length > 0) {
        for (const event of result.events) {
          await eventBus.emit({ ...event, ...eventContext });
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
            eventContext,
          ),
        );
      }
    } catch (error) {
      if (error instanceof ChannelUnavailableError) {
        // Not a processing failure and not something to alert about: the
        // business switched this number off. The caller is the queue the
        // message came from, and it needs the throw to know the reply never
        // went out, so this is the one error that is passed on rather than
        // absorbed here.
        logger.warn(
          {
            tenantId,
            channelAccountId,
            phoneNumber,
            messageId,
            status: error.status,
          },
          "Channel account is not active; leaving this message for its queue",
        );
        throw error;
      }

      logger.error(
        {
          error,
          tenantId,
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
          eventContext,
        ),
      );
    }
  });
}

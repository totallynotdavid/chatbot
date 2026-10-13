import { getProvider } from "@vendeya/intelligence";
import type { ConversationRef, QuotedMessageContext } from "@vendeya/types";
import {
  ChannelUnavailableError,
  WhatsAppService,
} from "../../adapters/whatsapp/index.ts";
import { ProductService } from "../../domains/catalog/products.ts";
import { assignNextAgentHeld } from "../../domains/conversations/assignment.ts";
import { createLogger } from "../../lib/logger.ts";
import { createEvent, eventBus } from "../../shared/events/index.ts";
import { withLock } from "../locks.ts";
import { claimMessageAlert, raiseUnreadAlert } from "../unread-alerts.ts";
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

    // A person-held conversation gets a read receipt but no typing indicator
    // because the bot sends no reply.
    const held = conversation.phase.phase === "escalated";
    await WhatsAppService.markAsRead(ref, messageId, { typing: !held });

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

      // The only place a turn emits `escalation_triggered`. Core and the
      // enrichment loop leave it out of `result.events`. An escalated
      // conversation stays escalated on every later message, and only the turn
      // that escalates it alerts and picks an agent. The agent is assigned
      // first, so the alert reaches them and not the sales group.
      // A later held message alerts the assigned agent only when no unread
      // alert already represents the conversation. Both alerts are awaited
      // inside the lock: the next message must see the marker as the delivery
      // left it, kept or released.
      if (result.type === "update" && result.nextPhase.phase === "escalated") {
        if (!held) {
          assignNextAgentHeld(ref);
          raiseUnreadAlert(ref);
          await eventBus.emit(
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
        } else if (claimMessageAlert(ref)) {
          await eventBus.emit(
            createEvent(
              "customer_message_received",
              { phoneNumber, clientName: conversation.metadata.name },
              eventContext,
            ),
          );
        }
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

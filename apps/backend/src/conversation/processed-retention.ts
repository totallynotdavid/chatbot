import { purgeProcessedHeldMessages } from "./held-messages.ts";
import { purgeProcessedInbox } from "./message-inbox.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("processed-retention");

/**
 * How long an answered `message_inbox` or `held_messages` row is kept.
 *
 * Those rows are the only record `isQueued` and `isHeld` have that a Meta
 * message id was already taken in. Meta retries a webhook delivery it did not
 * see acknowledged for up to 7 days, so a row deleted sooner lets a late
 * redelivery be answered a second time.
 */
export const PROCESSED_MESSAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Delete answered rows from both queues once they are past retention. */
export function purgeProcessedMessages(now: number = Date.now()): {
  inbox: number;
  held: number;
} {
  const before = now - PROCESSED_MESSAGE_RETENTION_MS;
  const purged = {
    inbox: purgeProcessedInbox(before),
    held: purgeProcessedHeldMessages(before),
  };

  if (purged.inbox > 0 || purged.held > 0) {
    logger.info(purged, "Purged processed messages past retention");
  }

  return purged;
}

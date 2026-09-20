import { purgeProcessedHeldMessages } from "./held-messages.ts";
import { purgeProcessedInbox } from "./message-inbox.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("processed-retention");

/**
 * Answered `message_inbox` and `held_messages` rows are the only record
 * `isQueued` and `isHeld` have of a Meta message id. Meta retries an
 * unacknowledged delivery for up to 7 days, so a row deleted sooner lets a late
 * redelivery be answered twice.
 */
export const PROCESSED_MESSAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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

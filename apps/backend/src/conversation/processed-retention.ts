import { purgeProcessedInbox } from "./message-inbox.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("processed-retention");

/**
 * Answered `message_inbox` rows are the only record `isQueued` has of a Meta
 * message id. Meta retries an unacknowledged delivery for up to 7 days, so a
 * row deleted sooner lets a late redelivery be answered twice.
 */
export const PROCESSED_MESSAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function purgeProcessedMessages(now: number = Date.now()): number {
  const purged = purgeProcessedInbox(now - PROCESSED_MESSAGE_RETENTION_MS);

  if (purged > 0) {
    logger.info({ inbox: purged }, "Purged processed messages past retention");
  }

  return purged;
}

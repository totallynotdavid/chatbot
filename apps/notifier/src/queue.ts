import { getMessagingService } from "./direct-messaging.ts";
import { getGroupJID } from "./group-registry.ts";
import { createLogger } from "./logger.ts";

const logger = createLogger("queue");

type QueuedMessage = {
  channel: "agent" | "dev" | "sales" | "direct";
  message: string;
  phoneNumber?: string;
  attempts: number;
};

const queue: QueuedMessage[] = [];
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

let processing = false;

export function enqueueMessage(
  channel: "agent" | "dev" | "sales" | "direct",
  message: string,
  phoneNumber?: string,
) {
  queue.push({ channel, message, phoneNumber, attempts: 0 });
  processQueue();
}

async function processQueue() {
  if (processing || queue.length === 0) return;

  processing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;

    try {
      await sendMessage(item.channel, item.message, item.phoneNumber);
      logger.debug(
        {
          channel: item.channel,
          phoneNumber: item.phoneNumber,
        },
        "Message sent",
      );
    } catch (error) {
      item.attempts++;
      const errorDetails =
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { raw: String(error) };

      if (item.attempts < MAX_RETRIES) {
        logger.warn(
          {
            ...errorDetails,
            channel: item.channel,
            attempt: item.attempts,
          },
          "Send failed, retrying",
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        queue.unshift(item);
      } else {
        logger.error(
          {
            ...errorDetails,
            channel: item.channel,
            phoneNumber: item.phoneNumber,
            messagePreview: item.message.substring(0, 100),
          },
          "Message permanently failed",
        );
      }
    }

    // Rate limiting: wait 1 second between messages
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  processing = false;
}

async function sendMessage(
  channel: "agent" | "dev" | "sales" | "direct",
  message: string,
  phoneNumber?: string,
) {
  const messagingService = getMessagingService();

  if (channel === "direct" && phoneNumber) {
    await messagingService.sendToCloudJid(phoneNumber, message);
    return;
  }

  const channelName = channel as "agent" | "dev" | "sales";
  const jid = getGroupJID(channelName);
  if (!jid) {
    throw new Error(`No group JID configured for channel: ${channelName}`);
  }

  await messagingService.sendToGroup(jid, message);
}

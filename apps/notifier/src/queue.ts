import { client, getGroupJID } from "./client.ts";
import { appLogger, messageLogger } from "./logger.ts";

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
    const item = queue.shift()!;

    try {
      await sendMessage(item.channel, item.message, item.phoneNumber);
      messageLogger.info(
        {
          channel: item.channel,
          phoneNumber: item.phoneNumber,
          messagePreview: item.message.substring(0, 50),
        },
        "Message sent",
      );
    } catch (error) {
      item.attempts++;
      if (item.attempts < MAX_RETRIES) {
        appLogger.warn(
          {
            error,
            channel: item.channel,
            attempt: item.attempts,
            maxRetries: MAX_RETRIES,
          },
          "Message send failed, retrying",
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        queue.unshift(item); // Re-queue at front
      } else {
        appLogger.error(
          {
            error,
            channel: item.channel,
            phoneNumber: item.phoneNumber,
            message: item.message,
          },
          "Message permanently failed after max retries",
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
  if (!client) {
    throw new Error("WhatsApp client not initialized");
  }

  // Direct messaging to specific phone number
  if (channel === "direct" && phoneNumber) {
    const formattedJid = `${phoneNumber.replace(/\D/g, "")}@s.whatsapp.net`;
    await client.sendMessage(formattedJid, message);
    return;
  }

  // Group messaging
  const channelName = channel as "agent" | "dev" | "sales";
  const jid = getGroupJID(channelName);
  if (!jid) {
    throw new Error(`No group JID configured for channel: ${channelName}`);
  }

  await client.sendMessage(jid, message);
}

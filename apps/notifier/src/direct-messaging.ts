import { client } from "./client.ts";
import { MessageMedia } from "whatsapp-web.js";
import { messageLogger } from "./logger.ts";

export async function sendDirectMessage(
  phoneNumber: string,
  content: string,
): Promise<boolean> {
  if (!client) {
    throw new Error("WhatsApp client not initialized");
  }

  try {
    const jid = formatPhoneToJid(phoneNumber);
    await client.sendMessage(jid, content);
    messageLogger.debug({ phoneNumber, jid }, "Direct message sent");
    return true;
  } catch (error) {
    messageLogger.error(
      { error, phoneNumber },
      "Failed to send direct message",
    );
    throw error;
  }
}

export async function sendDirectImage(
  phoneNumber: string,
  imageUrl: string,
  caption?: string,
): Promise<boolean> {
  if (!client) {
    throw new Error("WhatsApp client not initialized");
  }

  try {
    const jid = formatPhoneToJid(phoneNumber);
    const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
    await client.sendMessage(jid, media, { caption });
    messageLogger.debug({ phoneNumber, imageUrl, jid }, "Direct image sent");
    return true;
  } catch (error) {
    messageLogger.error(
      { error, phoneNumber, imageUrl },
      "Failed to send direct image",
    );
    throw error;
  }
}

function formatPhoneToJid(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  return `${digits}@c.us`;
}

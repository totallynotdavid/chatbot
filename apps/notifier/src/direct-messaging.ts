import { client } from "./client.ts";
import { MessageMedia } from "whatsapp-web.js";

export async function sendDirectMessage(
  phoneNumber: string,
  content: string,
): Promise<boolean> {
  if (!client) {
    throw new Error("WhatsApp client not initialized");
  }

  const jid = formatPhoneToJid(phoneNumber);
  await client.sendMessage(jid, content);
  return true;
}

export async function sendDirectImage(
  phoneNumber: string,
  imageUrl: string,
  caption?: string,
): Promise<boolean> {
  if (!client) {
    throw new Error("WhatsApp client not initialized");
  }

  const jid = formatPhoneToJid(phoneNumber);
  const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });

  await client.sendMessage(jid, media, { caption });
  return true;
}

function formatPhoneToJid(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  return `${digits}@c.us`;
}

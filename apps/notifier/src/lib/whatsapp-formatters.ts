/**
 * WhatsApp JID (Jabber ID) formatting utilities.
 * These are specific to whatspp-web.js format conversions.
 */

export function extractPhoneNumber(jid: string): string {
  return jid
    .replace("@c.us", "")
    .replace("@lid", "")
    .replace("@s.whatsapp.net", "")
    .replace(/\D/g, ""); // Remove any non-digits
}

export function formatPhoneToJid(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  return `${digits}@c.us`;
}

export function formatPhoneToCloudJid(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

export function isBroadcastJid(jid: string): boolean {
  return jid === "status@broadcast" || jid === "0@c.us";
}

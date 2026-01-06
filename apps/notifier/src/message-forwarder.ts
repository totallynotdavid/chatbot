import process from "node:process";
import type { Message } from "whatsapp-web.js";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

// Deduplication cache for WhatsApp Web JS (can fire duplicate events)
const forwardedMessages = new Set<string>();
const FORWARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function forwardToBackend(msg: Message): Promise<void> {
  const messageId = msg.id._serialized;

  // Skip if already forwarded
  if (forwardedMessages.has(messageId)) {
    return;
  }

  forwardedMessages.add(messageId);

  // Cleanup old entries after TTL
  setTimeout(() => {
    forwardedMessages.delete(messageId);
  }, FORWARD_CACHE_TTL_MS);
  // Extract phone number - handle both @c.us and @lid formats
  let phoneNumber = msg.from.replace("@c.us", "").replace("@lid", "");

  // For @lid format, try to get the actual phone number from contact
  if (msg.from.endsWith("@lid")) {
    try {
      const contact = await msg.getContact();
      if (contact.number) {
        phoneNumber = contact.number;
      }
    } catch (e) {
      console.warn(
        "[Forwarder] Could not get contact number from LID, using LID as-is",
      );
    }
  }

  // Map whatsapp-web.js message types to Cloud API format
  const messageType = msg.type === "chat" ? "text" : msg.type;

  // Build payload matching WhatsApp Cloud API webhook format
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: phoneNumber,
                  id: msg.id._serialized,
                  timestamp: msg.timestamp,
                  type: messageType,
                  text: msg.type === "chat" ? { body: msg.body } : undefined,
                },
              ],
            },
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(`${BACKEND_URL}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        "[Forwarder] Backend rejected:",
        response.status,
        await response.text(),
      );
    }
  } catch (error) {
    console.error("[Forwarder] Failed to forward to backend:", error);
  }
}

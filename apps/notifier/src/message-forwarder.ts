import process from "node:process";
import type { Message } from "whatsapp-web.js";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

export async function forwardToBackend(msg: Message): Promise<void> {
  const phoneNumber = msg.from.replace("@c.us", "");

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
                  type: msg.type,
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
      console.error("[Forwarder] Backend rejected:", await response.text());
    }
  } catch (error) {
    console.error("[Forwarder] Failed to forward to backend:", error);
  }
}

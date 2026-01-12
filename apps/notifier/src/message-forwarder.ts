import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Message } from "whatsapp-web.js";
import { parseIncomingMessage } from "./adapters/webjs-parser.ts";
import { createLogger } from "./logger.ts";

const logger = createLogger("forwarder");

function getBackendUrl(): string {
  const tunnelFile = resolve(import.meta.dir, "../../.cloudflare-url");
  if (existsSync(tunnelFile)) {
    const url = readFileSync(tunnelFile, "utf-8").trim();
    if (url) {
      logger.debug({ url, source: "tunnel" }, "Backend URL configured");
      return url;
    }
  }
  const fallback = process.env.BACKEND_URL || "http://localhost:3000";
  logger.debug({ url: fallback, source: "env" }, "Backend URL configured");
  return fallback;
}

const BACKEND_URL = getBackendUrl();

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

  // Parse message using our standardized parser
  const incomingMessage = await parseIncomingMessage(msg);

  // Build payload matching WhatsApp Cloud API webhook format
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: incomingMessage.from,
                  id: incomingMessage.id,
                  timestamp: Math.floor(incomingMessage.timestamp / 1000), // Convert back to seconds for Cloud API format
                  type:
                    incomingMessage.type === "text"
                      ? "text"
                      : incomingMessage.type,
                  text:
                    incomingMessage.type === "text"
                      ? { body: incomingMessage.body }
                      : undefined,
                  context: incomingMessage.quotedContext
                    ? { id: incomingMessage.quotedContext.id }
                    : undefined,
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
      const errorText = await response.text();
      logger.error(
        {
          status: response.status,
          error: errorText,
          messageId,
          from: incomingMessage.from,
        },
        "Backend rejected message",
      );
    }
  } catch (error) {
    logger.error(
      { error, messageId, from: incomingMessage.from },
      "Forward failed",
    );
  }
}

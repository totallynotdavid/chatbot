import type { Client, Message } from "whatsapp-web.js";
import process from "node:process";
import { forwardToBackend } from "./message-forwarder.ts";
import { saveGroupMapping } from "./group-registry.ts";
import { isGroupJid, isBroadcastJid } from "./lib/whatsapp-formatters.ts";
import { createLogger } from "./logger.ts";

const logger = createLogger("messages");
const IS_DEV = process.env.NODE_ENV === "development";

export function setupMessageHandler(client: Client) {
  client.on("message", async (msg) => {
    try {
      await handleMessage(msg);
    } catch (error) {
      logger.error({ error, from: msg.from }, "Message handling failed");
    }
  });
}

async function handleMessage(msg: Message) {
  const isGroupMessage = isGroupJid(msg.from);
  const isCommand = msg.body?.startsWith("@") || false;

  // Ignore system messages and broadcasts
  if (isBroadcastJid(msg.from)) return;

  // Ignore empty messages (except for group commands)
  const hasContent = msg.body && msg.body.trim().length > 0;
  if (!hasContent && !isGroupMessage) return;

  // Debug: log all incoming messages
  logger.debug(
    {
      from: msg.from,
      preview: msg.body?.substring(0, 50),
      isGroup: isGroupMessage,
      isCommand,
      fromMe: msg.fromMe,
    },
    "Message received",
  );

  if (IS_DEV && !isGroupMessage && !isCommand && msg.fromMe === false) {
    await forwardToBackend(msg);
    return;
  }

  if (msg.body === "@activate" && isGroupMessage) {
    await handleActivateCommand(msg);
  }
}

async function handleActivateCommand(msg: Message) {
  const chat = await msg.getChat();
  const groupName = chat.name || "unknown";

  saveGroupMapping(groupName, msg.from);

  await msg.reply(
    `Grupo "${groupName}" activado para notificaciones.\nJID: ${msg.from}`,
  );

  logger.info({ groupName, jid: msg.from }, "Group registered");
}

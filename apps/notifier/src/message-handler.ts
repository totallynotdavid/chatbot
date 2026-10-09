import type { Client, Message } from "whatsapp-web.js";
import { saveGroupMapping } from "./group-registry.ts";
import { isGroupJid } from "./lib/whatsapp-formatters.ts";
import { createLogger } from "./logger.ts";

const logger = createLogger("messages");

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
  if (msg.body === "@activate" && isGroupJid(msg.from)) {
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

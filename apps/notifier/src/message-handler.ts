import type { Client, Message } from "whatsapp-web.js";
import process from "node:process";
import { forwardToBackend } from "./message-forwarder.ts";
import { saveGroupMapping } from "./group-registry.ts";
import { appLogger, messageLogger } from "./logger.ts";

const IS_DEV = process.env.NODE_ENV === "development";

export function setupMessageHandler(client: Client) {
  client.on("message", async (msg) => {
    try {
      await handleMessage(msg);
    } catch (error) {
      messageLogger.error({ error, from: msg.from }, "Error handling message");
    }
  });
}

async function handleMessage(msg: Message) {
  const isGroupMessage = msg.from.endsWith("@g.us");
  const isCommand = msg.body?.startsWith("@") || false;

  messageLogger.info(
    {
      from: msg.from,
      body: msg.body?.substring(0, 50),
      isGroup: isGroupMessage,
      isCommand,
      fromMe: msg.fromMe,
    },
    "Received message",
  );

  if (IS_DEV && !isGroupMessage && !isCommand && msg.fromMe === false) {
    messageLogger.debug({ from: msg.from }, "Forwarding message to backend");
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

  appLogger.info(
    { groupName, jid: msg.from },
    "Group registered via @activate",
  );
}

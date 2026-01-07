import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { forwardToBackend } from "./message-forwarder.ts";
import { appLogger, messageLogger } from "./logger.ts";

const DATA_PATH = process.env.NOTIFIER_DATA_PATH || "./data/notifier";
const IS_DEV = process.env.NODE_ENV === "development";

// Ensure data directory exists
fs.mkdirSync(DATA_PATH, { recursive: true });

export let client: Client | null = null;

export const groupMapping = new Map<string, string>();

// Load group mapping from file if exists
const MAPPING_FILE = path.join(DATA_PATH, "group_mapping.json");
if (fs.existsSync(MAPPING_FILE)) {
  const data = JSON.parse(fs.readFileSync(MAPPING_FILE, "utf-8"));
  Object.entries(data).forEach(([key, jid]) => {
    groupMapping.set(key, jid as string);
  });
  appLogger.info(
    { groups: Array.from(groupMapping.keys()) },
    "Loaded group mapping",
  );
}

function saveGroupMapping() {
  const obj = Object.fromEntries(groupMapping.entries());
  fs.writeFileSync(MAPPING_FILE, JSON.stringify(obj, null, 2));
}

export async function initializeWhatsAppClient() {
  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: DATA_PATH,
    }),
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: process.env.NODE_ENV === "production",
      executablePath: process.env.CHROMIUM_PATH || "",
    },
  });

  client.on("qr", (qr) => {
    appLogger.info("QR code generated for authentication");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    appLogger.info({ devMode: IS_DEV }, "WhatsApp client ready");
  });

  client.on("authenticated", () => {
    appLogger.info("WhatsApp authenticated");
  });

  client.on("auth_failure", (msg) => {
    appLogger.error({ reason: msg }, "WhatsApp authentication failed");
  });

  // Auto-register groups with @activate command
  client.on("message", async (msg) => {
    const isGroupMessage = msg.from.endsWith("@g.us");
    const isCommand = msg.body?.startsWith("@") || false;

    messageLogger.debug(
      {
        from: msg.from,
        body: msg.body?.substring(0, 50),
        isGroup: isGroupMessage,
        isCommand,
        fromMe: msg.fromMe,
      },
      "Received message",
    );

    // Forward messages to backend in dev mode (exclude groups and commands)
    if (IS_DEV && !isGroupMessage && !isCommand && msg.fromMe === false) {
      messageLogger.debug({ from: msg.from }, "Forwarding message to backend");
      await forwardToBackend(msg);
      return;
    }

    if (msg.body === "@activate" && msg.from.endsWith("@g.us")) {
      const chat = await msg.getChat();
      const groupName = chat.name || "unknown";

      groupMapping.set(groupName, msg.from);
      saveGroupMapping();

      await msg.reply(
        `Grupo "${groupName}" activado para notificaciones.\nJID: ${msg.from}`,
      );

      appLogger.info(
        { groupName, jid: msg.from },
        "Group registered via @activate",
      );
    }
  });

  await client.initialize();
}

export function getGroupJID(channel: "agent" | "dev" | "sales"): string | null {
  const envKeyMap = {
    agent: "WHATSAPP_GROUP_AGENT",
    dev: "WHATSAPP_GROUP_DEV",
    sales: "WHATSAPP_GROUP_SALES",
  };

  const envJID = process.env[envKeyMap[channel]];
  if (envJID) return envJID;

  // Try mapping
  const mappingKeyMap = {
    agent: "agent_team",
    dev: "dev_team",
    sales: "sales_team",
  };

  return groupMapping.get(mappingKeyMap[channel]) || null;
}

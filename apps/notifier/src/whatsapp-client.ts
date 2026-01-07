import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import process from "node:process";
import fs from "node:fs";
import { setupMessageHandler } from "./message-handler.ts";
import { appLogger } from "./logger.ts";

const DATA_PATH = process.env.NOTIFIER_DATA_PATH || "./data/notifier";
const IS_DEV = process.env.NODE_ENV === "development";

export let client: Client | null = null;

export async function initializeWhatsAppClient() {
  fs.mkdirSync(DATA_PATH, { recursive: true });

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

  setupClientEventHandlers(client);
  setupMessageHandler(client);

  await client.initialize();
}

function setupClientEventHandlers(client: Client) {
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
}

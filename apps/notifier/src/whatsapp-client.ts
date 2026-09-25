import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import process from "node:process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { setupMessageHandler } from "./message-handler.ts";
import { createLogger } from "./logger.ts";

const logger = createLogger("whatsapp");
const DATA_PATH = process.env.NOTIFIER_DATA_PATH || "./data";

export let client: Client | null = null;

const requireFromWhatsApp = createRequire(
  import.meta.resolve("whatsapp-web.js"),
);
const puppeteer = requireFromWhatsApp("puppeteer") as {
  executablePath(): string | Promise<string>;
};

export async function initializeWhatsAppClient() {
  fs.mkdirSync(DATA_PATH, { recursive: true });
  const executablePath = await browserExecutablePath();

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: DATA_PATH,
    }),
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
      executablePath,
    },
    webVersionCache: {
      type: "remote",
      remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/refs/heads/main/html/2.3000.1031490220-alpha.html`,
    },
  });

  setupClientEventHandlers(client);
  setupMessageHandler(client);

  await client.initialize();
}

async function browserExecutablePath(): Promise<string> {
  const executablePath =
    process.env.CHROME_PATH || (await puppeteer.executablePath());

  if (!fs.existsSync(executablePath)) {
    throw new Error(
      "No Chrome or Chromium browser was found. Set CHROME_PATH to its executable or install one with `bunx puppeteer browsers install chrome`.",
    );
  }

  return executablePath;
}

function setupClientEventHandlers(client: Client) {
  client.on("qr", (qr) => {
    logger.info("QR code ready. Scan to authenticate");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    logger.info("WhatsApp client connected");
  });

  client.on("auth_failure", (msg) => {
    logger.error({ reason: msg }, "WhatsApp authentication failed");
  });
}

import pino from "pino";
import path from "node:path";
import process from "node:process";

const DATA_PATH = process.env.NOTIFIER_DATA_PATH || "./data/notifier";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const IS_DEV = process.env.NODE_ENV === "development";

// Base configuration
const baseConfig = {
  level: LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
};

// Development: pretty print to console
const devTransport = {
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss",
      ignore: "pid,hostname",
    },
  },
};

// Production: JSON logs to files
function createFileLogger(filename: string) {
  return pino(
    baseConfig,
    pino.destination({
      dest: path.join(DATA_PATH, "logs", filename),
      sync: false,
      mkdir: true,
    }),
  );
}

// Application logger: service lifecycle, errors, important events
export const appLogger = IS_DEV
  ? pino({ ...baseConfig, ...devTransport })
  : createFileLogger("notifier.log");

// Message logger: WhatsApp events, message flows, debugging
export const messageLogger = IS_DEV
  ? pino({ ...baseConfig, name: "messages", ...devTransport })
  : createFileLogger("messages.log");

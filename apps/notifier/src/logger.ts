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

// Create logger that writes to both console and file
function createLogger(filename: string, name?: string) {
  if (IS_DEV) {
    // Dev: pretty console + file
    return pino({
      ...baseConfig,
      name,
      transport: {
        targets: [
          {
            target: "pino-pretty",
            level: LOG_LEVEL,
            options: {
              colorize: true,
              translateTime: "HH:MM:ss",
              ignore: "pid,hostname",
            },
          },
          {
            target: "pino/file",
            level: LOG_LEVEL,
            options: {
              destination: path.join(DATA_PATH, "logs", filename),
              mkdir: true,
            },
          },
        ],
      },
    });
  }

  // Production: JSON to file only
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
export const appLogger = createLogger("notifier.log");

// Message logger: WhatsApp events, message flows, debugging
export const messageLogger = createLogger("messages.log", "messages");

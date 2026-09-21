import { createRootLogger, type Logger } from "@vendeya/logger";
import process from "node:process";

const DATA_PATH = process.env.NOTIFIER_DATA_PATH || "./data";

const rootLogger = createRootLogger({
  name: "notifier",
  logDir: `${DATA_PATH}/logs`,
  filename: "notifier.log",
  isDevelopment: process.env.NODE_ENV === "development",
});

export function createLogger(
  module: string,
  context?: Record<string, unknown>,
): Logger {
  const child = rootLogger.child({ module, ...context });

  // Check for module-specific log level override
  const moduleEnvKey = `LOG_LEVEL_${module.toUpperCase()}`;
  const moduleLevel = process.env[moduleEnvKey];

  if (moduleLevel) {
    child.level = moduleLevel;
  }

  return child;
}

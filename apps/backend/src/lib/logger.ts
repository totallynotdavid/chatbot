import { createRootLogger, type Logger } from "@totem/logger";
import process from "node:process";

const rootLogger = createRootLogger({
  name: "backend",
  logDir: "./data/logs",
  filename: "backend.log",
  isDevelopment: process.env.NODE_ENV === "development",
});

function getModuleLogLevel(module: string): string | undefined {
  const envKey = `LOG_LEVEL_${module.toUpperCase()}`;
  return process.env[envKey];
}

/**
 * Creates a logger with optional module-specific level override via LOG_LEVEL_<MODULE> env var.
 */
export function createLogger(
  module: string,
  context?: Record<string, unknown>,
): Logger {
  if (!module || typeof module !== "string") {
    throw new Error("Logger module name must be a non-empty string");
  }

  const child = rootLogger.child({ module, ...context });
  const moduleLevel = getModuleLogLevel(module);

  if (moduleLevel) {
    child.level = moduleLevel;
  }

  return child;
}

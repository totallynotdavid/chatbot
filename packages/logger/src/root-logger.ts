import pino from "pino";
import type { Logger, LoggerOptions } from "pino";
import process from "node:process";
import { parseLogConfig } from "./config";
import { createDevTransports, createProdDestination } from "./transports";

export interface LoggerConfig {
  name: string;
  logDir: string;
  filename?: string;
  isDevelopment?: boolean;
  baseLevel?: string;
}

function validateConfig(config: LoggerConfig): void {
  if (!config.name) {
    throw new Error("Logger name is required");
  }
  if (!config.logDir) {
    throw new Error("Logger directory is required");
  }
}

function getBaseConfig(config: LoggerConfig): LoggerOptions {
  const level = config.baseLevel || parseLogConfig().default;

  return {
    level,
    name: config.name,
    timestamp: pino.stdTimeFunctions.isoTime,
    // An Error has no enumerable properties, so it logs as `{}` unless
    // serialized. Pino covers `err` by default. Callers here pass `error`.
    serializers: { error: pino.stdSerializers.err },
  };
}

export function createRootLogger(config: LoggerConfig): Logger {
  validateConfig(config);

  const isDev = config.isDevelopment ?? process.env.NODE_ENV === "development";
  const baseConfig = getBaseConfig(config);

  if (isDev) {
    const targets = createDevTransports(
      baseConfig.level as string,
      config.logDir,
      config.filename,
    );
    return pino({ ...baseConfig, transport: { targets } });
  }

  if (config.filename) {
    const destination = createProdDestination(config.logDir, config.filename);
    return pino(baseConfig, pino.destination(destination));
  }

  return pino(baseConfig);
}

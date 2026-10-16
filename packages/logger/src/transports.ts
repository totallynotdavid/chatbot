import type { TransportTargetOptions } from "pino";

export function createDevTransports(
  level: string,
  logDir?: string,
  filename?: string,
): TransportTargetOptions[] {
  const targets: TransportTargetOptions[] = [
    {
      target: "pino-pretty",
      level,
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  ];

  if (logDir && filename) {
    targets.push({
      target: "pino/file",
      level,
      options: {
        destination: `${logDir}/${filename}`,
        mkdir: true,
      },
    });
  }

  return targets;
}

export function createProdDestination(logDir: string, filename: string) {
  return {
    dest: `${logDir}/${filename}`,
    sync: false,
    mkdir: true,
  };
}

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

declare global {
  interface ImportMeta {
    readonly dir: string;
  }
}

function readTunnelUrl(): string | null {
  const tunnelFile = resolve(import.meta.dir, "../../../.cloudflare-url");

  if (!existsSync(tunnelFile)) return null;

  const url = readFileSync(tunnelFile, "utf-8").trim();
  return url || null;
}

/** Public frontend URL for notification links and CORS validation. */
export function getFrontendUrl(): string {
  return readTunnelUrl() ?? "http://localhost:5173";
}

/** Backend base URL for notifier webhooks and SSR API calls. */
export function getBackendUrl(): string {
  return "http://localhost:3000";
}

/** Public URL for media assets, using the tunnel in development or PUBLIC_URL in production. */
export function getPublicUrl(): string {
  return readTunnelUrl() ?? process.env.PUBLIC_URL ?? "http://localhost:5173";
}

/** Notifier base URL used by the backend for messaging. */
export function getNotifierUrl(): string {
  return "http://localhost:3001";
}

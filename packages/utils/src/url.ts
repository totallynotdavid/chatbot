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

/**
 * Publicly accessible frontend URL.
 *
 * Used by:
 * - WhatsApp notification links
 * - Backend CORS origin validation
 */
export function getFrontendUrl(): string {
  return readTunnelUrl() ?? "http://localhost:5173";
}

/**
 * Backend base URL.
 *
 * Used by:
 * - Notifier -> backend webhook calls
 * - Frontend SSR API calls
 */
export function getBackendUrl(): string {
  return "http://localhost:3000";
}

/**
 * Public base URL for externally accessible static assets.
 *
 * Used by:
 * - WhatsApp Cloud API media URLs
 *
 * Notes:
 * - Dev: Cloudflare tunnel (via vite proxy)
 * - Prod: PUBLIC_URL
 */
export function getPublicUrl(): string {
  return readTunnelUrl() ?? process.env.PUBLIC_URL ?? "http://localhost:5173";
}

/**
 * Notifier service base URL.
 *
 * Used by:
 * - Backend -> notifier messaging
 */
export function getNotifierUrl(): string {
  return "http://localhost:3001";
}

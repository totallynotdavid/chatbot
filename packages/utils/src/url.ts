import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Reads the Cloudflare tunnel URL from .cloudflare-url file at repo root.
 *
 * Returns null if file doesn't exist or is empty.
 */
function readTunnelUrl(): string | null {
  const tunnelFile = resolve(import.meta.dir, "../../../.cloudflare-url");

  if (existsSync(tunnelFile)) {
    const url = readFileSync(tunnelFile, "utf-8").trim();
    return url || null;
  }

  return null;
}

/**
 * Get frontend URL (for links to dashboard).
 *
 * Priority: .cloudflare-url > FRONTEND_URL > localhost:5173
 */
export function getFrontendUrl(): string {
  return readTunnelUrl() ?? process.env.FRONTEND_URL ?? "http://localhost:5173";
}

/**
 * Get backend URL (for API calls from frontend/notifier).
 *
 * Priority: .cloudflare-url > BACKEND_URL > localhost:3000
 */
export function getBackendUrl(): string {
  return readTunnelUrl() ?? process.env.BACKEND_URL ?? "http://localhost:3000";
}

/**
 * Get public URL (for static assets accessible from WhatsApp).
 *
 * Priority: .cloudflare-url > PUBLIC_URL > localhost:3000
 */
export function getPublicUrl(): string {
  return readTunnelUrl() ?? process.env.PUBLIC_URL ?? "http://localhost:3000";
}

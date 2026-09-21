import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

declare global {
  interface ImportMeta {
    readonly dir: string;
  }
}

const LOCAL_ORIGIN = "http://localhost:5173";

// Resolved on call: the frontend build imports this module under Node, where
// `import.meta.dir` is undefined.
function defaultTunnelFile(): string {
  return resolve(import.meta.dir, "../../../.cloudflare-url");
}

function readTunnelUrl(tunnelFile: string): string | null {
  if (!existsSync(tunnelFile)) return null;

  const url = readFileSync(tunnelFile, "utf-8").trim();
  return url || null;
}

/**
 * The address the outside world reaches the frontend at, with no trailing
 * slash: CORS compares the origin exactly, and links append a path.
 *
 * Outside production a running tunnel wins over `PUBLIC_URL`, because `.env`
 * copied from `.env.example` sets `PUBLIC_URL` to localhost and Meta cannot
 * reach that. In production only `PUBLIC_URL` counts: `dev:tunnel` leaves
 * `.cloudflare-url` behind when it stops, and a stale file must not redirect
 * links.
 */
export function publicOrigin(tunnelFile: string = defaultTunnelFile()): string {
  const tunnelUrl =
    process.env.NODE_ENV === "production" ? null : readTunnelUrl(tunnelFile);
  const url = tunnelUrl ?? (process.env.PUBLIC_URL?.trim() || LOCAL_ORIGIN);

  return url.replace(/\/+$/, "");
}

/** Frontend URL for notification links and the CORS origin. */
export function getFrontendUrl(): string {
  return publicOrigin();
}

/** Backend base URL for notifier webhooks and SSR API calls. */
export function getBackendUrl(): string {
  return "http://localhost:3000";
}

/** Public URL for media assets, which the frontend serves under `/media`. */
export function getPublicUrl(): string {
  return publicOrigin();
}

/**
 * Notifier base URL used by the backend for messaging. The notifier listens on
 * 127.0.0.1 only, and `localhost` may resolve to `::1`, which nothing listens on.
 */
export function getNotifierUrl(): string {
  return "http://127.0.0.1:3001";
}

import process from "node:process";

const LOCAL_ORIGIN = "http://localhost:5173";

/**
 * The address the outside world reaches the frontend at, with no trailing
 * slash: CORS compares the origin exactly, and links append a path.
 */
export function publicOrigin(): string {
  const url = process.env.PUBLIC_URL?.trim() || LOCAL_ORIGIN;

  return url.replace(/\/+$/, "");
}

/** Frontend URL for notification links and the CORS origin. */
export function getFrontendUrl(): string {
  return publicOrigin();
}

/** Backend base URL for the frontend's server-side API calls. */
export function getBackendUrl(): string {
  return "http://localhost:3000";
}

/** Public URL for media assets, which the frontend serves under `/media`. */
export function getPublicUrl(): string {
  return publicOrigin();
}

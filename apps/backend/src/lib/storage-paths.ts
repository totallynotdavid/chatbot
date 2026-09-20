/**
 * Roots for every store that holds uploaded bytes. Nothing outside this module
 * builds a path under `data/uploads` or `data/private`, and
 * tests/storage-path-guard.test.ts enforces that.
 */

import path from "node:path";
import process from "node:process";

/**
 * Base of every upload store. In production it is a persistent volume, and the
 * working directory is ephemeral. A root derived from the working directory
 * loses its files on redeploy and leaves `assets` rows that answer 404.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";

/**
 * The images root is always absolute. `adapters/storage/images.ts` and Hono's
 * `serveStatic` each resolve a relative path against their own working
 * directory, so a relative root could name two directories.
 */
export function resolveImagesDir(uploadDir: string): string {
  return path.join(path.resolve(uploadDir), "images");
}

/**
 * Catalog images are the only bytes served statically, because Meta fetches the
 * image link of an outgoing image message without credentials.
 */
export const IMAGES_DIR = resolveImagesDir(UPLOAD_DIR);

/**
 * The seeded catalog photos as tracked in git. That directory is IMAGES_DIR only
 * in development, so `db/seeds/images.ts` copies them into IMAGES_DIR on boot.
 */
export const SEED_IMAGES_DIR = path.join(
  // Resolved against this module, so it names the checkout wherever it runs.
  import.meta.dir,
  "..",
  "..",
  "data",
  "uploads",
  "images",
);

/**
 * The default is a sibling of the uploads directory, never a child, so the
 * private root stays outside the uploads directory that the HTTP server mounts.
 * PRIVATE_DIR overrides it. The result is absolute because `privateFilePath`
 * compares resolved paths against it.
 */
export function resolvePrivateDir(env: {
  uploadDir: string;
  privateDir?: string | undefined;
}): string {
  if (env.privateDir) return path.resolve(env.privateDir);

  return path.join(path.dirname(path.resolve(env.uploadDir)), "private");
}

/**
 * Files that are never served statically: signed contracts and call recordings,
 * reachable only through /api/assets/:id, which checks tenant scope first.
 */
export const PRIVATE_DIR = resolvePrivateDir({
  uploadDir: UPLOAD_DIR,
  privateDir: process.env.PRIVATE_DIR,
});

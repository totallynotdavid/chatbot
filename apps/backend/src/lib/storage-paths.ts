/**
 * Where uploaded bytes live, for every store that holds them.
 *
 * These are resolved in one place because they have to move together. In
 * production UPLOAD_DIR points at a persistent volume (`/var/lib/totem/uploads`
 * in .env.production.example) while the process's working directory is
 * ephemeral - a new one on every restart or redeploy. The private store used to
 * hardcode `<cwd>/data/private`, so contracts and call recordings were written
 * somewhere that did not survive a restart: the `assets` rows stayed in the
 * database and /api/assets/:id answered 404 for every contract and recording
 * taken before it. The catalog image store and the static mount that serves it
 * had the same bug in the same shape - `<cwd>/data/uploads/images` in one file
 * and `./data/uploads/images` in the other - which lost every uploaded product
 * photo on redeploy and left the `assets` rows naming files that were gone.
 *
 * Deriving every root from the same base keeps the stores on the same volume,
 * whatever that volume is. Nothing outside this module builds a path under
 * `data/uploads` or `data/private` of its own; tests/storage-path-guard.test.ts
 * enforces that, because this mistake has now been made three times.
 */

import path from "node:path";
import process from "node:process";

/** Publicly served files (catalog images). Mounted at /media/images. */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";

/**
 * Where catalog images go, given the uploads root.
 *
 * Split out from the constant below for the same reason `resolvePrivateDir` is:
 * the constant is read once at module load, so the derivation is only checkable
 * on its own if it is a function of its input rather than of the environment.
 *
 * Absolute, because the two consumers disagree about what a relative path would
 * even mean: `adapters/storage/images.ts` resolves it against the working
 * directory, and Hono's `serveStatic` resolves its `root` against the working
 * directory of whatever process it is mounted in. Resolving once here means
 * both read the same directory under any UPLOAD_DIR.
 */
export function resolveImagesDir(uploadDir: string): string {
  return path.join(path.resolve(uploadDir), "images");
}

/**
 * Catalog images: the only bytes served statically, deliberately so - Meta
 * fetches the image link we hand it with no credentials when sending an image
 * message. Mounted at /media/images by index.ts.
 */
export const IMAGES_DIR = resolveImagesDir(UPLOAD_DIR);

/**
 * The catalog photos the base catalog is seeded with, as they ship in the
 * repository.
 *
 * Every seeded bundle names one of these by `image_id`, and they are tracked in
 * git under the backend's own `data/uploads/images` - which is the development
 * IMAGES_DIR, and nothing else. Under any other UPLOAD_DIR the store serves from
 * a directory these files were never put in, so `db/seeds/images.ts` copies them
 * there on boot.
 *
 * Resolved against this module, not the working directory: it names a place in
 * the checkout of the code, wherever that checkout is run from.
 */
export const SEED_IMAGES_DIR = path.join(
  import.meta.dir,
  "..",
  "..",
  "data",
  "uploads",
  "images",
);

/**
 * Where the private store goes, given the two environment variables.
 *
 * Split out from the constant below so it can be checked directly: the whole
 * point of the change is which base the path is built on, and that is a pure
 * question about strings.
 *
 * The default is a *sibling* of the uploads directory rather than a directory
 * inside it - being outside the one directory the HTTP server mounts is what
 * makes the store private - so `/var/lib/totem/uploads` gives
 * `/var/lib/totem/private`, and the development default `./data/uploads` gives
 * `<cwd>/data/private`, exactly where it has always been. PRIVATE_DIR overrides
 * it for a deployment that wants the two on separate volumes.
 *
 * Always absolute, because `privateFilePath` compares resolved paths against it
 * to refuse a key that climbs out of the root.
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

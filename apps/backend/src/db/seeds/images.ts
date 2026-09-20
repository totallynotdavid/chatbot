import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { IMAGES_DIR, SEED_IMAGES_DIR } from "../../lib/storage-paths.ts";
import { createLogger } from "../../lib/logger.ts";
import { BUNDLES_SEED } from "../seed-data/bundles.ts";
import { FNB_BUNDLES_SEED } from "../seed-data/fnb-bundles.ts";

const logger = createLogger("seed-images");

/** Every image a seeded bundle names, once each. */
export const SEEDED_IMAGE_IDS: readonly string[] = [
  ...new Set(
    [...BUNDLES_SEED, ...FNB_BUNDLES_SEED].map((bundle) => bundle.image_id),
  ),
];

/**
 * Copies the seeded catalog photos from the repository into the directory the
 * image store serves. A deployment whose UPLOAD_DIR is a new volume has none of
 * them until this runs. Runs on every boot and returns how many files it copied.
 */
export function seedCatalogImages(
  from: string = SEED_IMAGES_DIR,
  to: string = IMAGES_DIR,
): number {
  const source = path.resolve(from);
  const target = path.resolve(to);

  // With the development defaults both directories are the same one.
  if (source === target) return 0;

  fs.mkdirSync(target, { recursive: true });

  let copied = 0;
  const unavailable: string[] = [];

  for (const imageId of SEEDED_IMAGE_IDS) {
    const name = `${imageId}.jpg`;
    const destination = path.join(target, name);

    // A file already present is left alone, whatever it holds, so nothing an
    // operator put there is overwritten.
    if (fs.existsSync(destination)) continue;

    const origin = path.join(source, name);
    if (!fs.existsSync(origin)) {
      unavailable.push(imageId);
      continue;
    }

    // Copy to a temporary name and rename it into place. A boot that dies
    // mid-copy then leaves no file that a later boot would take for finished.
    const staging = `${destination}.${process.pid}.partial`;
    fs.copyFileSync(origin, staging);
    fs.renameSync(staging, destination);
    copied++;
  }

  if (unavailable.length > 0) {
    // Missing source images do not stop the boot. The affected bundles have no
    // image to serve until the files are restored.
    logger.error(
      { source, imageIds: unavailable },
      "Seeded catalog images are missing from the application's own copy; " +
        "the bundles naming them have no image to serve",
    );
  }

  if (copied > 0) {
    logger.info({ source, target, copied }, "Installed seeded catalog images");
  }

  return copied;
}

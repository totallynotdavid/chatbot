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
 * Put the base catalog's photos where the image store serves them from.
 *
 * The seeded bundles name their images by id, and the bytes behind those ids
 * ship in the repository - under the development IMAGES_DIR, which is the only
 * place they have ever been. A deployment with UPLOAD_DIR on a volume
 * (`/var/lib/totem/uploads`, as .env.production.example documents) seeded every
 * bundle with an image that did not exist there: /media/images answered 404,
 * and every catalog image message handed Meta a link it could not fetch and was
 * recorded as failed. Nothing about that is specific to migrating - a brand new
 * deployment had it too.
 *
 * Runs on every boot and is idempotent. A file already present is left alone,
 * whatever it holds, so nothing an operator put there is overwritten; a missing
 * one is copied to a temporary name and renamed into place, so a boot that dies
 * mid-copy leaves nothing behind that a later boot would mistake for finished.
 * With the development defaults the two directories are the same one and there
 * is nothing to do.
 *
 * Returns how many files were copied.
 */
export function seedCatalogImages(
  from: string = SEED_IMAGES_DIR,
  to: string = IMAGES_DIR,
): number {
  const source = path.resolve(from);
  const target = path.resolve(to);

  if (source === target) return 0;

  fs.mkdirSync(target, { recursive: true });

  let copied = 0;
  const unavailable: string[] = [];

  for (const imageId of SEEDED_IMAGE_IDS) {
    const name = `${imageId}.jpg`;
    const destination = path.join(target, name);

    if (fs.existsSync(destination)) continue;

    const origin = path.join(source, name);
    if (!fs.existsSync(origin)) {
      unavailable.push(imageId);
      continue;
    }

    const staging = `${destination}.${process.pid}.partial`;
    fs.copyFileSync(origin, staging);
    fs.renameSync(staging, destination);
    copied++;
  }

  if (unavailable.length > 0) {
    // Not a reason to refuse the boot - the bot answers in text without them -
    // but these bundles will show no image until the files are restored.
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

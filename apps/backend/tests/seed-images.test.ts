/**
 * The seeded catalog's photos, on a deployment whose uploads live on a volume.
 *
 * Every seeded bundle names its image by id, and the 53 files behind those ids
 * are tracked in git under the backend's own uploads directory - which is the
 * development IMAGES_DIR and nothing more. Round 13 correctly moved the image
 * store onto UPLOAD_DIR; nothing moved the seed images with it. So under a
 * production-shaped UPLOAD_DIR, fresh or migrated, every seeded bundle pointed
 * at a file the store had never been given: /media/images answered 404 and every
 * catalog image message handed Meta a link it could not fetch.
 *
 * No earlier test could see it, because every test that touches images writes
 * its own files into IMAGES_DIR first. The last describe here writes nothing:
 * it boots the real server against an empty volume and asks for the images.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { SEEDED_IMAGE_IDS, seedCatalogImages } from "../src/db/seeds/images.ts";
import { SEED_IMAGES_DIR } from "../src/lib/storage-paths.ts";

const seedBytes = (imageId: string) =>
  readFileSync(join(SEED_IMAGES_DIR, `${imageId}.jpg`));

describe("installing the seeded catalog images", () => {
  let dir: string;
  let volume: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-seed-images-"));
    volume = join(dir, "uploads", "images");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("ships a file for every image a seeded bundle names", () => {
    // Otherwise the copy below would be faithfully installing a gap.
    const missing = SEEDED_IMAGE_IDS.filter(
      (id) => !existsSync(join(SEED_IMAGES_DIR, `${id}.jpg`)),
    );
    expect(missing).toEqual([]);
    expect(SEEDED_IMAGE_IDS.length).toBeGreaterThan(0);
  });

  it("copies every one of them onto an empty volume, byte for byte", () => {
    expect(seedCatalogImages(SEED_IMAGES_DIR, volume)).toBe(
      SEEDED_IMAGE_IDS.length,
    );

    for (const imageId of SEEDED_IMAGE_IDS) {
      expect(readFileSync(join(volume, `${imageId}.jpg`))).toEqual(
        seedBytes(imageId),
      );
    }

    // And leaves no staging file behind in the served directory.
    expect(readdirSync(volume).filter((f) => !f.endsWith(".jpg"))).toEqual([]);
  });

  it("copies nothing the second time, so it is safe on every boot", () => {
    seedCatalogImages(SEED_IMAGES_DIR, volume);

    expect(seedCatalogImages(SEED_IMAGES_DIR, volume)).toBe(0);
  });

  it("leaves a file already on the volume alone", () => {
    const [kept] = SEEDED_IMAGE_IDS;
    mkdirSync(volume, { recursive: true });
    writeFileSync(join(volume, `${kept}.jpg`), "replaced by an operator");

    expect(seedCatalogImages(SEED_IMAGES_DIR, volume)).toBe(
      SEEDED_IMAGE_IDS.length - 1,
    );
    expect(readFileSync(join(volume, `${kept}.jpg`), "utf-8")).toBe(
      "replaced by an operator",
    );
  });

  it("does nothing when the volume is the repository's own copy", () => {
    // The development default: IMAGES_DIR is where the files are tracked.
    expect(seedCatalogImages(SEED_IMAGES_DIR, SEED_IMAGES_DIR)).toBe(0);
  });

  it("installs what it has when a shipped file is missing, without failing", () => {
    const partial = join(dir, "partial-checkout");
    mkdirSync(partial);
    const [absent, ...present] = SEEDED_IMAGE_IDS;
    for (const imageId of present) {
      writeFileSync(join(partial, `${imageId}.jpg`), seedBytes(imageId));
    }

    expect(seedCatalogImages(partial, volume)).toBe(present.length);
    expect(existsSync(join(volume, `${absent}.jpg`))).toBe(false);
  });
});

/** A port nothing else is using, for the boot below. */
function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("probe") });
  const port = server.port ?? 0;
  server.stop(true);
  if (port === 0) throw new Error("Could not reserve a port for the boot test");
  return port;
}

describe("booting with UPLOAD_DIR on a volume of its own", () => {
  it("serves every seeded bundle's image from that volume", async () => {
    const root = mkdtempSync(join(tmpdir(), "totem-seed-images-boot-"));
    // Three different places, as in production: the volume the uploads live
    // on, the database, and a working directory that is neither of them nor
    // the repository.
    const uploads = join(root, "volume", "uploads");
    const workdir = join(root, "cwd");
    mkdirSync(workdir, { recursive: true });
    const dbPath = join(root, "boot.sqlite");
    const port = freePort();

    const child = Bun.spawn(
      [
        "bun",
        "--install=disable",
        "run",
        join(import.meta.dir, "..", "src", "index.ts"),
      ],
      {
        cwd: workdir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          NODE_ENV: "test",
          PORT: String(port),
          DB_PATH: dbPath,
          UPLOAD_DIR: uploads,
          PRIVATE_DIR: join(root, "volume", "private"),
        },
      },
    );

    const output = async () =>
      (await new Response(child.stdout).text()) +
      (await new Response(child.stderr).text());

    try {
      // Up once it answers anything at all; an unauthenticated 401 is quickest.
      const deadline = Date.now() + 45_000;
      let served = false;
      while (!served && Date.now() < deadline && child.exitCode === null) {
        try {
          const response = await fetch(
            `http://localhost:${port}/api/conversations`,
            { signal: AbortSignal.timeout(2_000) },
          );
          await response.arrayBuffer();
          served = true;
        } catch {
          await Bun.sleep(50);
        }
      }

      if (!served) {
        child.kill();
        await child.exited;
        throw new Error(`The server never came up:\n${await output()}`);
      }

      const seeded = new Database(dbPath, { readonly: true });
      const imageIds = (
        seeded
          .prepare("SELECT DISTINCT image_id FROM catalog_bundles")
          .all() as Array<{ image_id: string }>
      ).map((row) => row.image_id);
      seeded.close();

      // The boot seeded the catalog; otherwise the rest proves nothing.
      expect(imageIds.length).toBeGreaterThan(0);

      for (const imageId of imageIds) {
        // On the volume, readable, and the bytes the repository ships...
        expect(readFileSync(join(uploads, "images", `${imageId}.jpg`))).toEqual(
          seedBytes(imageId),
        );

        // ...and served from there, which is the link Meta is handed.
        const response = await fetch(
          `http://localhost:${port}/media/images/${imageId}.jpg`,
        );
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(
          seedBytes(imageId),
        );
      }

      // Nothing went under the working directory's own uploads.
      expect(existsSync(join(workdir, "data", "uploads"))).toBe(false);
    } finally {
      child.kill();
      await child.exited;
      rmSync(root, { recursive: true, force: true });
    }
  }, 90_000);
});

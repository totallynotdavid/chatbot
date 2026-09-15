/**
 * Where the two stores put their bytes.
 *
 * Regression, and a data-loss one: `private-files.ts` built its root from
 * `process.cwd()` and never looked at UPLOAD_DIR. In production UPLOAD_DIR is a
 * persistent volume (`/var/lib/totem/uploads`) and the working directory is
 * replaced on every restart or redeploy, so signed contracts and call
 * recordings were written where they could not survive one - the `assets` rows
 * did survive, and /api/assets/:id answered 404 for every file taken before the
 * restart.
 *
 * Then the same bug turned up again, unchanged, in the catalog image store: it
 * joined `<cwd>/data/uploads/images` for itself instead of taking the root that
 * had just been centralised, so every product photo was lost on the next
 * redeploy while its `assets` row stayed behind naming it. Both stores are
 * covered here now, and tests/storage-path-guard.test.ts checks mechanically
 * that no third one grows its own root.
 *
 * The derivation is checked directly, and then the real stores are booted in a
 * subprocess with a production-shaped UPLOAD_DIR to prove the wiring, since the
 * constants are read once at module load.
 */

import { describe, it, expect } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import process from "node:process";
import sharp from "sharp";

import {
  IMAGES_DIR,
  resolveImagesDir,
  resolvePrivateDir,
} from "../src/lib/storage-paths.ts";

describe("resolving the private storage root", () => {
  it("puts it beside a production UPLOAD_DIR, not under the working directory", () => {
    const resolved = resolvePrivateDir({
      uploadDir: "/var/lib/totem/uploads",
      privateDir: undefined,
    });

    expect(resolved).toBe("/var/lib/totem/private");
    // The bug in one assertion: the old root was always under the cwd.
    expect(resolved.startsWith(process.cwd() + sep)).toBe(false);
  });

  it("keeps the development default exactly where it was", () => {
    // `path.join(process.cwd(), "data", "private")`, which is what the
    // hardcoded root used to be, for the default UPLOAD_DIR.
    expect(
      resolvePrivateDir({ uploadDir: "./data/uploads", privateDir: undefined }),
    ).toBe(join(process.cwd(), "data", "private"));
  });

  it("lets PRIVATE_DIR override it outright", () => {
    expect(
      resolvePrivateDir({
        uploadDir: "/var/lib/totem/uploads",
        privateDir: "/mnt/contracts",
      }),
    ).toBe("/mnt/contracts");
  });

  it("returns an absolute path even for a relative override", () => {
    // `privateFilePath` compares resolved paths against this root to refuse a
    // key climbing out of it, which a relative root would break.
    expect(
      resolvePrivateDir({ uploadDir: "./data/uploads", privateDir: "./priv" }),
    ).toBe(join(process.cwd(), "priv"));
  });

  it("never nests the private store inside the served uploads directory", () => {
    for (const uploadDir of ["/var/lib/totem/uploads", "./data/uploads"]) {
      const uploads = join(uploadDir, "");
      const resolved = resolvePrivateDir({ uploadDir, privateDir: undefined });

      expect(resolved.startsWith(uploads + sep)).toBe(false);
    }
  });
});

describe("resolving the catalog image root", () => {
  it("sits inside a production UPLOAD_DIR", () => {
    // Catalog images are the one thing served statically (/media/images), so
    // unlike the private store this root belongs *under* the uploads volume.
    expect(resolveImagesDir("/var/lib/totem/uploads")).toBe(
      "/var/lib/totem/uploads/images",
    );
  });

  it("keeps the development default exactly where it was", () => {
    // `path.join(process.cwd(), "data", "uploads", "images")`, which is what
    // the hardcoded root used to be, for the default UPLOAD_DIR.
    expect(resolveImagesDir("./data/uploads")).toBe(
      join(process.cwd(), "data", "uploads", "images"),
    );
  });

  it("is absolute, so both of its consumers read the same directory", () => {
    // `serveStatic` resolves a relative root against the working directory of
    // whichever process mounts it; the store resolves one against its own. A
    // relative root is how the mount and the store came to disagree.
    expect(isAbsolute(resolveImagesDir("./data/uploads"))).toBe(true);
    // And the constant the application actually uses is one of these.
    expect(isAbsolute(IMAGES_DIR)).toBe(true);
  });
});

/**
 * The constants are read at module load, so the only way to see a store use
 * them is to load it again with a different environment. Both probes below are
 * run that way.
 *
 * A probe imports the module under test by **absolute path**, and imports
 * nothing by bare name. That is a hard requirement, not a style: a probe file
 * lives in a temp directory with no `node_modules` above it, so a bare
 * specifier cannot resolve through the repository's packages at all. Bun falls
 * back to auto-installing it from the npm registry instead - which succeeds
 * silently on a warm global cache and, on a cold one or a restricted network,
 * blocks with no output on either stream until the test's own timeout kills it.
 * `sharp` was imported that way here and did exactly that. The module under
 * test resolves its own dependencies normally, because it is read from inside
 * the repository where `node_modules` is where it belongs.
 *
 * `--install=disable` holds that line: a bare specifier that creeps back in
 * fails immediately with "Cannot find package" rather than reaching for the
 * network.
 */

/** What a probe reported on stdout, or a failure that says what went wrong. */
function runProbe(source: string, uploadDir: string, cwd: string): string {
  const probe = join(uploadDir, "..", "probe.ts");
  writeFileSync(probe, source);

  const result = Bun.spawnSync(["bun", "--install=disable", "run", probe], {
    // A working directory that is not where the files must land, which is the
    // whole scenario: in production these differ.
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      UPLOAD_DIR: uploadDir,
    },
  });

  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();

  // Reported together, because the useful diagnosis is always the combination:
  // a probe that resolved nothing exits non-zero with an empty stdout, and
  // parsing that silence as a result is how this test failed unreadably once.
  if (result.exitCode !== 0 || stdout === "") {
    throw new Error(
      `Probe exited ${result.exitCode} (signal ${result.signalCode ?? "none"}) ` +
        `with ${stdout === "" ? "no stdout" : `stdout: ${stdout}`}\n` +
        (stderr === "" ? "and nothing on stderr." : `stderr:\n${stderr}`),
    );
  }

  expect(stderr).toBe("");

  return stdout;
}

describe("the private store under a production-shaped environment", () => {
  it("writes onto the UPLOAD_DIR volume rather than the working directory", () => {
    const volume = mkdtempSync(join(tmpdir(), "totem-volume-"));
    // A working directory of its own, so "nothing landed under the cwd" is a
    // statement about a directory this test owns and starts empty.
    const workdir = mkdtempSync(join(tmpdir(), "totem-cwd-"));

    const written = runProbe(
      `import { privateFileStorage, privateFilePath } from ${JSON.stringify(
        join(
          import.meta.dir,
          "..",
          "src",
          "adapters",
          "storage",
          "private-files.ts",
        ),
      )};
       await privateFileStorage.write("tenant-x/contract.pdf", Buffer.from("signed"));
       console.log(privateFilePath("tenant-x/contract.pdf"));`,
      join(volume, "uploads"),
      workdir,
    );

    expect(written).toBe(join(volume, "private", "tenant-x", "contract.pdf"));
    expect(readFileSync(written, "utf-8")).toBe("signed");
    // Nothing under the process's own directory, which is what used to happen.
    expect(existsSync(join(workdir, "data"))).toBe(false);

    rmSync(volume, { recursive: true, force: true });
    rmSync(workdir, { recursive: true, force: true });
  }, 30_000);
});

/**
 * The same proof for the image store, which is the file that had the bug the
 * second time.
 *
 * `store()` puts the bytes through sharp, so they have to be a real JPEG. It is
 * encoded *here*, in a process that resolves `sharp` through the repository's
 * own node_modules, and travels to the probe as a base64 literal - the probe
 * itself imports nothing it cannot reach by absolute path. `images.ts` still
 * imports sharp for itself, and resolves it normally from inside the repo,
 * which is what makes this an end-to-end check of the store rather than of a
 * path string.
 */
describe("the catalog image store under a production-shaped environment", () => {
  it("writes onto the UPLOAD_DIR volume rather than the working directory", async () => {
    const volume = mkdtempSync(join(tmpdir(), "totem-images-volume-"));
    const workdir = mkdtempSync(join(tmpdir(), "totem-images-cwd-"));

    const jpeg = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .jpeg()
      .toBuffer();

    const reported = runProbe(
      `import { imageStorage } from ${JSON.stringify(
        join(import.meta.dir, "..", "src", "adapters", "storage", "images.ts"),
      )};
       const jpeg = Buffer.from(${JSON.stringify(jpeg.toString("base64"))}, "base64");
       const id = await imageStorage.store(jpeg);
       console.log(JSON.stringify({ id, exists: await imageStorage.exists(id) }));`,
      join(volume, "uploads"),
      workdir,
    );

    const { id, exists } = JSON.parse(reported) as {
      id: string;
      exists: boolean;
    };

    // On the volume, where the static mount and the next deploy will find it.
    expect(existsSync(join(volume, "uploads", "images", `${id}.jpg`))).toBe(
      true,
    );
    // And the store agrees the file it just wrote is there, which is what
    // `exists()` answers for the delete and repair paths.
    expect(exists).toBe(true);
    // Nothing under the process's own directory, which is what used to happen.
    expect(existsSync(join(workdir, "data"))).toBe(false);

    rmSync(volume, { recursive: true, force: true });
    rmSync(workdir, { recursive: true, force: true });
  }, 30_000);
});

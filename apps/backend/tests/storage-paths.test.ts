/**
 * UPLOAD_DIR is a persistent volume in production and the working directory is
 * replaced on every deploy, so neither store may derive its root from the cwd.
 * The subprocess tests exist because the roots are read once at module load.
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
      uploadDir: "/var/lib/vendeya/uploads",
      privateDir: undefined,
    });

    expect(resolved).toBe("/var/lib/vendeya/private");
    // A deploy replaces the working directory, so the root must not be under it.
    expect(resolved.startsWith(process.cwd() + sep)).toBe(false);
  });

  it("keeps the development default exactly where it was", () => {
    // Existing development data under `data/private` must stay readable.
    expect(
      resolvePrivateDir({ uploadDir: "./data/uploads", privateDir: undefined }),
    ).toBe(join(process.cwd(), "data", "private"));
  });

  it("lets PRIVATE_DIR override it outright", () => {
    expect(
      resolvePrivateDir({
        uploadDir: "/var/lib/vendeya/uploads",
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
    for (const uploadDir of ["/var/lib/vendeya/uploads", "./data/uploads"]) {
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
    expect(resolveImagesDir("/var/lib/vendeya/uploads")).toBe(
      "/var/lib/vendeya/uploads/images",
    );
  });

  it("keeps the development default exactly where it was", () => {
    // Existing development images under `data/uploads/images` must stay
    // readable.
    expect(resolveImagesDir("./data/uploads")).toBe(
      join(process.cwd(), "data", "uploads", "images"),
    );
  });

  it("is absolute, so both of its consumers read the same directory", () => {
    // `serveStatic` resolves a relative root against the working directory of
    // the process that mounts it. The store resolves one against its own. A
    // relative root would let the mount and the store disagree.
    expect(isAbsolute(resolveImagesDir("./data/uploads"))).toBe(true);
    // `IMAGES_DIR` is the constant the application uses.
    expect(isAbsolute(IMAGES_DIR)).toBe(true);
  });
});

/**
 * Runs `source` in a fresh process, since the roots are read once at module
 * load. Returns its stdout, or throws with the exit code and stderr.
 */
function runProbe(source: string, uploadDir: string, cwd: string): string {
  const probe = join(uploadDir, "..", "probe.ts");
  writeFileSync(probe, source);

  // The probe file has no node_modules above it, so a bare import cannot
  // resolve and Bun would install it from the registry, blocking silently on a
  // cold cache. `--install=disable` makes that fail at once. Probe sources must
  // import by absolute path.
  const result = Bun.spawnSync(["bun", "--install=disable", "run", probe], {
    // The cwd differs from the volume, as in production.
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      UPLOAD_DIR: uploadDir,
    },
  });

  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();

  // A probe that resolved nothing exits non-zero with an empty stdout, so the
  // error reports the exit code, stdout and stderr together.
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
    const volume = mkdtempSync(join(tmpdir(), "vendeya-volume-"));
    // A working directory of its own, so the `data` check below is about a
    // directory this test owns and starts empty.
    const workdir = mkdtempSync(join(tmpdir(), "vendeya-cwd-"));

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
    // No `data` directory may appear under the working directory.
    expect(existsSync(join(workdir, "data"))).toBe(false);

    rmSync(volume, { recursive: true, force: true });
    rmSync(workdir, { recursive: true, force: true });
  }, 30_000);
});

describe("the catalog image store under a production-shaped environment", () => {
  it("writes onto the UPLOAD_DIR volume rather than the working directory", async () => {
    const volume = mkdtempSync(join(tmpdir(), "vendeya-images-volume-"));
    const workdir = mkdtempSync(join(tmpdir(), "vendeya-images-cwd-"));

    // `store()` runs the bytes through sharp, so they must be a real JPEG. The
    // probe cannot resolve `sharp` by bare name, so the JPEG is encoded here and
    // passed as a base64 literal. The store resolves `sharp` from the repository.
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
    // The store's own `exists()` must agree with the file on the volume.
    expect(exists).toBe(true);
    // No `data` directory may appear under the working directory.
    expect(existsSync(join(workdir, "data"))).toBe(false);

    rmSync(volume, { recursive: true, force: true });
    rmSync(workdir, { recursive: true, force: true });
  }, 30_000);
});

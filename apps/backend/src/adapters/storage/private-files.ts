/**
 * Storage for files that must never be served statically: signed contracts and
 * call recordings.
 *
 * These live under `<PRIVATE_DIR>/<tenant>/...`, deliberately outside the
 * uploads directory (the only one the HTTP server mounts). The bytes are
 * reachable only through /api/assets/:id, which checks tenant scope first.
 *
 * The root comes from lib/storage-paths.ts, so it sits on the same persistent
 * volume as UPLOAD_DIR rather than under the process's working directory.
 */

import { mkdir } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { PRIVATE_DIR as PRIVATE_ROOT } from "../../lib/storage-paths.ts";

/** Strip anything that could climb out of the tenant's directory. */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._+-]/g, "_");
  return cleaned === "." || cleaned === ".." || cleaned === "" ? "_" : cleaned;
}

export function privateStorageKey(
  tenantId: string,
  ...segments: string[]
): string {
  return [safeSegment(tenantId), ...segments.map(safeSegment)].join("/");
}

/**
 * Absolute location of a storage key, refusing anything that resolves outside
 * the private root.
 *
 * Exported because the migration writes into this store too, and has to go
 * through the same check rather than joining paths of its own: the keys it
 * builds come from a legacy column, which nothing ever validated.
 */
export function privateFilePath(storageKey: string): string {
  const resolved = path.resolve(PRIVATE_ROOT, storageKey);

  // Belt and braces: a key that resolves outside the root is a bug, not a read.
  if (
    resolved !== PRIVATE_ROOT &&
    !resolved.startsWith(PRIVATE_ROOT + path.sep)
  ) {
    throw new Error(
      `Refusing to access path outside private storage: ${storageKey}`,
    );
  }

  return resolved;
}

export const privateFileStorage = {
  async write(storageKey: string, data: Buffer): Promise<void> {
    const target = privateFilePath(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await Bun.write(target, data);
  },

  /** Bun file handle for streaming a response, or null when it is missing. */
  read(storageKey: string) {
    const target = privateFilePath(storageKey);
    if (!fs.existsSync(target)) return null;
    return Bun.file(target);
  },

  async delete(storageKey: string): Promise<void> {
    try {
      fs.unlinkSync(privateFilePath(storageKey));
    } catch {
      // Already gone
    }
  },
};

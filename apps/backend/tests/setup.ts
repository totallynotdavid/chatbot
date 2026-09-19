/**
 * Test bootstrap. `bunfig.toml` preloads this before any test file, which is
 * the only moment early enough to matter: `src/db/connection.ts` opens DB_PATH
 * the first time anything imports it, and `src/lib/storage-paths.ts` reads
 * UPLOAD_DIR and PRIVATE_DIR once at module load. From then on the whole suite
 * - the fixtures, the routers, the seeds, both file stores - works through
 * whatever those three named.
 *
 * All three default to somewhere real, and `bun test` runs with the
 * repository's own .env, so without this the suite would run against the
 * developer's actual data. DB_PATH defaults to ./data/database.sqlite, where
 * `applySchema` would migrate a pre-tenancy schema in place (rename aside,
 * rebuild, copy, drop) and every fixture would insert and delete real rows.
 * UPLOAD_DIR defaults to ./data/uploads, whose `images/` directory is tracked
 * in git and holds the catalog photos the seeds ship: tests write and delete
 * files there by id, which self-corrects on a clean run and leaves strays in a
 * tracked directory on a crashed or killed one. PRIVATE_DIR is where contracts
 * and call recordings land.
 *
 * A fresh temp directory per run keeps all of it where it belongs, and makes
 * the cleanup in the tests themselves incapable of deleting anything real.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { TEST_APP_SECRET } from "./helpers/webhook.ts";

const dir = mkdtempSync(join(tmpdir(), "totem-test-"));

// The suite mocks Cloud API responses, so NODE_ENV must select the test adapter.
process.env.NODE_ENV = "test";
process.env.DB_PATH = join(dir, "test.sqlite");
process.env.UPLOAD_DIR = join(dir, "uploads");
process.env.PRIVATE_DIR = join(dir, "private");
process.env.WHATSAPP_APP_SECRET = TEST_APP_SECRET;

process.on("exit", () => {
  rmSync(dir, { recursive: true, force: true });
});

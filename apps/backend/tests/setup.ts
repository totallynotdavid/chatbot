/**
 * Preloaded by `bunfig.toml`, before any test file loads. `connection.ts` opens
 * DB_PATH on first import and `storage-paths.ts` reads UPLOAD_DIR and
 * PRIVATE_DIR once at module load.
 */

import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { closeTestServer } from "./helpers/postgres.ts";
import { TEST_APP_SECRET } from "./helpers/webhook.ts";

// A temp directory per run keeps the tests' own cleanup away from real files.
const dir = mkdtempSync(join(tmpdir(), "vendeya-test-"));

// The suite mocks Cloud API responses. NODE_ENV=development would select the
// dev adapter instead, so it is set to `test`.
process.env.NODE_ENV = "test";
// Left to its default, DB_PATH is the developer's database. `applySchema`
// would migrate it in place and the fixtures would insert and delete real rows.
process.env.DB_PATH = join(dir, "test.sqlite");
// The default upload directory has a git-tracked `images/` directory. A run
// that is killed mid-test would leave stray files in it.
process.env.UPLOAD_DIR = join(dir, "uploads");
process.env.PRIVATE_DIR = join(dir, "private");
// The default log directory is under the working directory, which would fill
// `apps/backend/data/logs` with test output.
process.env.LOG_DIR = join(dir, "logs");
process.env.WHATSAPP_APP_SECRET = TEST_APP_SECRET;

// One Postgres template serves every test file, so it goes once, after the last.
afterAll(closeTestServer);

process.on("exit", () => {
  rmSync(dir, { recursive: true, force: true });
});

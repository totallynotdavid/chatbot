/**
 * Boots the database named by DB_PATH the way the server and `bun run account`
 * do, but only once the barrier file exists, so two of these start together.
 * Prints how many times the rebuild ran in this process. The `migrate` modes
 * count the schema passes their rebuild makes, and `init` runs the whole boot.
 */

import fs from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { db } from "../../src/db/connection.ts";
import { initializeDatabase } from "../../src/db/init.ts";
import {
  migrateAuditLogActor,
  migrateToMultiTenant,
  needsTenantMigration,
} from "../../src/db/migrations.ts";

const [mode, barrier] = process.argv.slice(2);
const schema = fs.readFileSync(
  join(import.meta.dir, "..", "..", "src", "db", "schema.sql"),
  "utf-8",
);

process.stdout.write("ready\n");
while (!fs.existsSync(barrier!)) {
  // Spin: a sleep would let the two processes drift apart.
}

let rebuilds = 0;
const countedSchema = (database: typeof db) => {
  rebuilds++;
  database.run(schema);
};

try {
  if (mode === "init") {
    initializeDatabase(db);
  } else if (mode === "migrate-tenants") {
    if (needsTenantMigration(db)) migrateToMultiTenant(db, countedSchema);
  } else {
    migrateAuditLogActor(db, countedSchema);
  }
  process.stdout.write(`rebuilds ${rebuilds}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
} finally {
  db.close();
}

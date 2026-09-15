import type { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { migrateToMultiTenant, needsTenantMigration } from "./migrations.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("db-init");

// Resolved against this module, not the working directory, so the schema is
// found whether the server, the seed script or a test drives initialisation.
const SCHEMA_PATH = path.join(import.meta.dir, "schema.sql");

function applySchema(db: Database) {
  db.run(fs.readFileSync(SCHEMA_PATH, "utf-8"));
}

export function initializeDatabase(db: Database) {
  // A database written before tenancy has to be rebuilt before the new schema
  // can be applied over it; a fresh or already-migrated one just gets the
  // CREATE TABLE IF NOT EXISTS pass.
  if (needsTenantMigration(db)) {
    migrateToMultiTenant(db, applySchema);
    return;
  }

  applySchema(db);
  warnIfChannelPairUnenforced(db);
}

/**
 * Every table carrying `tenant_id` and `channel_account_id` references the pair
 * on `channel_accounts(id, tenant_id)`, so a row cannot name one tenant beside
 * another tenant's number. `CREATE TABLE IF NOT EXISTS` cannot add that to a
 * database whose tables already exist, though, so a database created from an
 * earlier build of this schema keeps the old independent references and gets
 * no complaint from SQLite about it.
 *
 * Rebuilding it is the fix, and this says so rather than letting the deployment
 * believe in a constraint it does not have. The data this applies to is
 * pre-launch, so there is nothing to preserve.
 */
function warnIfChannelPairUnenforced(db: Database): void {
  const foreignKeys = db
    .prepare("PRAGMA foreign_key_list(conversations)")
    .all() as Array<{ table: string; from: string; to: string | null }>;

  const enforced = foreignKeys.some(
    (key) => key.table === "channel_accounts" && key.to === "tenant_id",
  );

  if (enforced) return;

  logger.error(
    "This database predates the composite (channel_account_id, tenant_id) " +
      "foreign key: a row may pair one tenant with another tenant's WhatsApp " +
      "number and SQLite will accept it. Delete the database file and let it " +
      "be recreated - the schema change cannot be applied in place.",
  );
}

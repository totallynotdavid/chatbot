import type { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  backfillTextActivityTimestamps,
  migrateAuditLogActor,
  migrateToMultiTenant,
  needsTenantMigration,
} from "./migrations.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("db-init");

const SCHEMA_PATH = path.join(import.meta.dir, "schema.sql");

function applySchema(db: Database) {
  db.run(fs.readFileSync(SCHEMA_PATH, "utf-8"));
}

export function initializeDatabase(db: Database) {
  // A legacy database is rebuilt before the schema is applied over it. Every
  // process then runs the same idempotent pass, including one that waited for
  // another process to finish the migration.
  if (needsTenantMigration(db)) {
    migrateToMultiTenant(db, applySchema);
  }

  applySchema(db);
  migrateAuditLogActor(db, applySchema);
  backfillTextActivityTimestamps(db);
  warnIfChannelPairUnenforced(db);
}

/**
 * Every table with `tenant_id` and `channel_account_id` references the pair on
 * `channel_accounts(id, tenant_id)`, so a row cannot name one tenant beside
 * another tenant's number.
 */
function warnIfChannelPairUnenforced(db: Database): void {
  const foreignKeys = db
    .prepare("PRAGMA foreign_key_list(conversations)")
    .all() as Array<{ table: string; from: string; to: string | null }>;

  const enforced = foreignKeys.some(
    (key) => key.table === "channel_accounts" && key.to === "tenant_id",
  );

  if (enforced) return;

  // `CREATE TABLE IF NOT EXISTS` cannot add the composite reference to an
  // existing table, so an older database keeps independent references and
  // SQLite reports nothing. Only a rebuild fixes it. The data is pre-launch, so
  // this logs an error instead of migrating.
  logger.error(
    "Database predates composite (channel_account_id, tenant_id) foreign key. " +
      "A row may pair one tenant with another's WhatsApp number without error. " +
      "Delete and recreate the database - the schema change cannot be applied in place.",
  );
}

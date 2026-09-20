/**
 * Migration from the single-business schema to the multi-tenant one.
 *
 * A database without a `tenants` table and `tenant_id` columns holds exactly one
 * business (Totem) on exactly one WhatsApp number (the WHATSAPP_* environment
 * variables). The migration creates that tenant and its channel account, then
 * stamps every existing row with them.
 *
 * Several tables change primary key, `conversations` most of all, and SQLite
 * cannot do that in place. Each such table is rebuilt: rename the old table
 * aside, create the new shape from schema.sql, copy the rows across with the
 * tenant columns filled in, and drop the original. All of it runs in one
 * transaction, so a failure leaves the database untouched.
 */

import type { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createLogger } from "../lib/logger.ts";
import { seedTenants } from "./seeds/tenants.ts";
import {
  privateFilePath,
  privateStorageKey,
} from "../adapters/storage/private-files.ts";

const logger = createLogger("db-migration");

function tableExists(db: Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== null && row !== undefined;
}

function indexExists(db: Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(name);
  return row !== null && row !== undefined;
}

function columnExists(db: Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return columns.some((c) => c.name === column);
}

export function needsTenantMigration(db: Database): boolean {
  if (!tableExists(db, "conversations")) return false;
  // Only `conversations.tenant_id` decides. A `tenants` table, even an empty
  // one, does not show that the legacy data has been migrated.
  return !columnExists(db, "conversations", "tenant_id");
}

/** Tables rebuilt because their shape or key changed. */
const REBUILT_TABLES = [
  "catalog_periods",
  "products",
  "catalog_bundles",
  "conversations",
  "messages",
  "message_inbox",
  "held_messages",
  "orders",
  "test_personas",
  "analytics_events",
  "llm_calls",
  "notification_traces",
  "audit_log",
  "users",
  "session",
] as const;

function legacyColumns(db: Database, table: string): string[] {
  const columns = db
    .prepare(`PRAGMA table_info(${table}_legacy)`)
    .all() as Array<{ name: string }>;
  // Generated columns cannot be inserted into.
  return columns.map((c) => c.name).filter((n) => n !== "current_state");
}

export function migrateToMultiTenant(
  db: Database,
  runSchema: (db: Database) => void,
): void {
  logger.info("Migrating single-business database to multi-tenant schema");

  const present = REBUILT_TABLES.filter((t) => tableExists(db, t));

  // Foreign keys must be off for the rebuild: renaming a table aside rewrites
  // the references pointing at it, and the legacy tables are dropped in an
  // order that would trip enforcement. The pragma is a no-op inside a
  // transaction, so it is set around it, and restored afterwards.
  const foreignKeysWereOn =
    (
      db.prepare("PRAGMA foreign_keys").get() as
        | { foreign_keys: number }
        | undefined
    )?.foreign_keys === 1;
  db.run("PRAGMA foreign_keys = OFF;");

  let migrated: ReturnType<typeof runMigration>;
  try {
    migrated = runMigration();
  } finally {
    if (foreignKeysWereOn) {
      db.run("PRAGMA foreign_keys = ON;");
    }
  }

  // This runs after the commit. Removing the originals any earlier would
  // destroy the copy source that makes a failed migration retryable.
  removeLegacyOriginals(migrated.copiedFiles);

  logger.info(
    {
      tenantId: migrated.tenant.id,
      channelAccountId: migrated.channelAccount.id,
      channelAccountStatus: migrated.channelAccount.status,
      uploadsMigrated: migrated.copiedFiles.length,
    },
    "Migration complete",
  );

  function runMigration() {
    return db.transaction(() => {
      // Drop the indexes and move the legacy tables aside, so schema.sql can
      // create the new shape and its indexes under the original names.
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
        )
        .all() as Array<{ name: string }>;
      for (const index of indexes) {
        db.run(`DROP INDEX IF EXISTS ${index.name}`);
      }

      for (const table of present) {
        db.run(`ALTER TABLE ${table} RENAME TO ${table}_legacy`);
      }

      runSchema(db);

      // Everything belonged to one tenant and one channel account. This is the
      // seed a fresh database gets, so the WHATSAPP_* credentials are imported
      // and encrypted when SECRETS_KEY is set. A placeholder row would be
      // refused by the adapter.
      const { tenant, channelAccount } = seedTenants(db);
      const tenantId = tenant.id;
      const channelAccountId = channelAccount.id;

      for (const table of present) {
        const columns = legacyColumns(db, table);
        copyTable(db, table, columns, tenantId, channelAccountId);
      }

      if (present.includes("users")) {
        migrateMemberships(db, tenantId);
      }

      if (present.includes("session")) {
        backfillSessionTenants(db);
      }

      // This reads the legacy recording columns, so it runs before the legacy
      // tables are dropped. A failed copy throws, which rolls the transaction
      // back onto intact legacy data.
      const copiedFiles = migrateRecordings(db, tenantId, channelAccountId);

      for (const table of present) {
        db.run(`DROP TABLE ${table}_legacy`);
      }

      return { tenant, channelAccount, copiedFiles };
    })();
  }
}

function migrateMemberships(db: Database, tenantId: string): void {
  // Availability is stored on the membership, so an agent who had switched
  // themselves off stays off.
  const available = legacyColumns(db, "users").includes("is_available")
    ? "COALESCE(is_available, 1)"
    : "1";

  db.prepare(
    `INSERT INTO tenant_memberships (id, tenant_id, user_id, role, is_available, created_at)
     SELECT lower(hex(randomblob(16))), ?, id, role, ${available}, created_at
     FROM users_legacy`,
  ).run(tenantId);
}

/**
 * Gives every carried-over session the scope a fresh login would give it. A
 * member's session with no active tenant has no scope, so `requireTenantScope`
 * answers 403. The dashboard shows the tenant picker to any user who has a
 * membership to pin (`showTenantSelector`).
 *
 * The rule is `defaultTenantForUser` restated in SQL. A platform operator gets
 * none because their scope is chosen. A user with exactly one membership gets
 * that one. A user with several gets none because only they can say which. The
 * SQL counts memberships in suspended tenants too, where `defaultTenantForUser`
 * counts only open ones. A pin on a suspended tenant is dropped when the
 * session is next validated, and an unpinned user picks a tenant.
 *
 * A single-business legacy database only produces the middle case. The function
 * is exported so the other two cases can be tested, and the rule is written out
 * in full so it stays correct against a database that already has several
 * tenants.
 */
export function backfillSessionTenants(db: Database): void {
  const updated = db
    .prepare(
      `UPDATE session
       SET active_tenant_id = (
         SELECT m.tenant_id FROM tenant_memberships m
         WHERE m.user_id = session.user_id
       )
       WHERE active_tenant_id IS NULL
         AND (
           SELECT COUNT(*) FROM tenant_memberships m
           WHERE m.user_id = session.user_id
         ) = 1
         AND EXISTS (
           SELECT 1 FROM users u
           WHERE u.id = session.user_id AND u.is_platform_operator = 0
         )`,
    )
    .run();

  logger.info(
    { sessions: updated.changes },
    "Pinned carried-over sessions to the tenant their user belongs to",
  );
}

/**
 * `audit_log` has two shapes. The legacy shape has no `actor` column and a NOT
 * NULL `user_id`. The current shape has `actor` and a nullable `user_id`. A
 * database from before tenancy reaches the current shape through
 * `migrateToMultiTenant`. A database from after tenancy reaches it here. Nothing
 * moves a table back. SQLite cannot drop NOT NULL in place, so the table is
 * rebuilt from schema.sql with its rows copied across.
 *
 * Every insert must supply `actor` once the shape is current. A build that omits
 * it fails on the NOT NULL constraint, so it cannot run against a migrated file.
 */
export function migrateAuditLogActor(
  db: Database,
  runSchema: (db: Database) => void,
): void {
  if (!tableExists(db, "audit_log") || columnExists(db, "audit_log", "actor")) {
    return;
  }

  const foreignKeysWereOn =
    (
      db.prepare("PRAGMA foreign_keys").get() as
        | { foreign_keys: number }
        | undefined
    )?.foreign_keys === 1;
  // The pragma is a no-op inside a transaction, so it is set around it.
  db.run("PRAGMA foreign_keys = OFF;");

  let rebuilt = false;

  try {
    // The backend, the seed and the account command each run this at startup.
    // `.immediate()` takes the write lock before the check inside, and one
    // transaction means a failure leaves the legacy table as it was.
    rebuilt = db
      .transaction(() => {
        // A process that waited for the lock finds the rebuild already done.
        if (columnExists(db, "audit_log", "actor")) return false;

        const indexes = db
          .prepare(
            `SELECT name, sql FROM sqlite_master
           WHERE type = 'index' AND tbl_name = 'audit_log' AND sql IS NOT NULL`,
          )
          .all() as Array<{ name: string; sql: string }>;
        // An index keeps its name when its table is renamed, which would make
        // the schema's CREATE INDEX IF NOT EXISTS skip it on the new table.
        for (const index of indexes) {
          db.run(`DROP INDEX "${index.name.replaceAll('"', '""')}"`);
        }

        db.run("ALTER TABLE audit_log RENAME TO audit_log_legacy");
        runSchema(db);

        // The schema recreates its own indexes. Any index it does not recreate,
        // such as one added by hand, moves to the new table with its definition.
        for (const index of indexes) {
          if (!indexExists(db, index.name)) db.run(index.sql);
        }

        db.run(
          `INSERT INTO audit_log (id, tenant_id, user_id, actor, action, resource_type, resource_id, metadata, created_at)
         SELECT id, tenant_id, user_id, 'user:' || user_id, action, resource_type, resource_id, metadata, created_at
         FROM audit_log_legacy`,
        );
        db.run("DROP TABLE audit_log_legacy");
        return true;
      })
      .immediate();
  } finally {
    if (foreignKeysWereOn) {
      db.run("PRAGMA foreign_keys = ON;");
    }
  }

  if (rebuilt) {
    logger.info(
      "Rebuilt audit_log with a nullable user_id and an actor column",
    );
  }
}

/**
 * Converts text `last_activity_at` values that SQLite can parse to epoch ms.
 * Any other value stays, because the column is NOT NULL and boot must not fail.
 */
export function backfillTextActivityTimestamps(db: Database): void {
  const converted = db
    .prepare(
      `UPDATE conversations
       SET last_activity_at =
         CAST(ROUND(unixepoch(last_activity_at, 'subsec') * 1000) AS INTEGER)
       WHERE typeof(last_activity_at) = 'text'
         AND strftime('%s', last_activity_at) IS NOT NULL`,
    )
    .run();

  if (converted.changes > 0) {
    logger.info(
      { conversations: converted.changes },
      "Converted text activity timestamps to epoch milliseconds",
    );
  }
}

/** A legacy upload copied into private storage, and where it came from. */
type CopiedUpload = { from: string; storageKey: string };

/**
 * A legacy upload's absolute path, or null when the stored value escapes the
 * directory legacy uploads live in.
 */
export function resolveLegacyUpload(
  legacyRoot: string,
  legacyPath: string,
): string | null {
  const resolved = path.resolve(legacyRoot, legacyPath);

  // `recording_contract_path` and `recording_audio_path` are unvalidated, so
  // they are input, not data. An absolute path or enough `../` resolves
  // anywhere the process can read. `privateFilePath` makes the same containment
  // check on the writing side.
  if (!isInside(legacyRoot, resolved)) return null;
  // A path that does not exist has nothing to read. It is returned as spelled
  // for the caller to report missing.
  if (!fs.existsSync(resolved)) return resolved;

  // A path that stays inside by its spelling can still leave through a
  // symbolic link, in the file or in any directory above it, and copying
  // follows links. The real path must be inside the real legacy root, and the
  // real path is what the caller copies.
  const real = fs.realpathSync(resolved);
  return isInside(fs.realpathSync(legacyRoot), real) ? real : null;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Converts the contract and recording paths kept on `conversations_legacy`,
 * written under `data/contracts/<phone>/`, into private assets under the
 * tenant's private prefix.
 *
 * Each file is copied, not moved, and the copy is verified before its asset row
 * is written. A failed copy throws, which aborts the migration with the legacy
 * tables and files untouched, so the run can be repeated. A move would be wrong
 * inside a transaction that can still roll back, because the database would
 * return to the legacy shape while the file it names had been renamed away.
 * `removeLegacyOriginals` deletes the originals after the transaction commits.
 */
function migrateRecordings(
  db: Database,
  tenantId: string,
  channelAccountId: string,
): CopiedUpload[] {
  const legacyCols = legacyColumns(db, "conversations");
  if (!legacyCols.includes("recording_contract_path")) return [];

  const rows = db
    .prepare(
      `SELECT phone_number, recording_contract_path, recording_audio_path
       FROM conversations_legacy
       WHERE recording_contract_path IS NOT NULL
          OR recording_audio_path IS NOT NULL`,
    )
    .all() as Array<{
    phone_number: string;
    recording_contract_path: string | null;
    recording_audio_path: string | null;
  }>;

  if (rows.length === 0) return [];

  const legacyRoot = path.join(process.cwd(), "data");
  const copied: CopiedUpload[] = [];

  const insertAsset = db.prepare(
    `INSERT INTO assets (id, tenant_id, kind, visibility, storage_key, created_at)
     VALUES (?, ?, ?, 'private', ?, unixepoch('now', 'subsec') * 1000)`,
  );

  const updateConversation = db.prepare(
    `UPDATE conversations
     SET recording_contract_asset_id = COALESCE(?, recording_contract_asset_id),
         recording_audio_asset_id = COALESCE(?, recording_audio_asset_id)
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
  );

  for (const row of rows) {
    const migrateUpload = (
      legacyPath: string | null,
      kind: "contract" | "recording",
    ): string | null => {
      if (!legacyPath) return null;

      // This is the key builder every other write to private storage uses. The
      // legacy path is unvalidated, so each segment is sanitised: `..` and
      // anything else that could climb out of the tenant's directory becomes an
      // underscore.
      const storageKey = privateStorageKey(
        tenantId,
        "legacy",
        ...legacyPath.split("/"),
      );
      const id = crypto.randomUUID();

      // The source path needs the same containment as the destination key, and
      // before anything is copied. Enough `../` would walk out of
      // `data/` and copy an arbitrary readable host file into the tenant's
      // private storage, where /api/assets/:id would serve it.
      const from = resolveLegacyUpload(legacyRoot, legacyPath);

      if (from === null) {
        logger.error(
          { legacyPath, assetId: id, phoneNumber: row.phone_number, kind },
          "Legacy upload path points outside data/; refusing to read it. No " +
            "asset is recorded for it - the value is not a path this " +
            "application ever wrote",
        );
        return null;
      }

      // A source that is already missing does not abort the migration. The
      // asset row is the surviving record that the upload happened, and
      // refusing to migrate would leave the deployment unmigratable over damage
      // that predates it.
      if (!fs.existsSync(from)) {
        logger.error(
          { from, assetId: id, phoneNumber: row.phone_number, kind },
          "Legacy upload is already missing on disk; the asset row records " +
            "that the upload happened, but its bytes were lost before this " +
            "migration ran and /api/assets/:id will report it missing",
        );
        insertAsset.run(id, tenantId, kind, storageKey);
        return id;
      }

      copyIntoPrivateStorage(from, storageKey);
      insertAsset.run(id, tenantId, kind, storageKey);
      copied.push({ from, storageKey });

      return id;
    };

    const contractAssetId = migrateUpload(
      row.recording_contract_path,
      "contract",
    );
    const audioAssetId = migrateUpload(row.recording_audio_path, "recording");

    updateConversation.run(
      contractAssetId,
      audioAssetId,
      tenantId,
      channelAccountId,
      row.phone_number,
    );
  }

  logger.info(
    { conversations: rows.length, files: copied.length },
    "Migrated uploaded contracts",
  );

  return copied;
}

/**
 * Copies one legacy upload to its private storage key and verifies that it
 * arrived. Every failure throws, which rolls the migration transaction back to
 * the legacy shape with the legacy file still in place. Logging and continuing
 * would leave an asset row pointing at a key with nothing behind it.
 */
function copyIntoPrivateStorage(from: string, storageKey: string): void {
  const to = privateFilePath(storageKey);

  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  } catch (error) {
    logger.error(
      { error, from, storageKey },
      "Could not copy a legacy upload into private storage; aborting the " +
        "migration with the legacy tables and files intact",
    );
    throw new Error(
      `Migration aborted: failed to copy legacy upload ${from} to ${storageKey}`,
      { cause: error },
    );
  }

  const source = fs.statSync(from);
  const target = fs.existsSync(to) ? fs.statSync(to) : null;

  if (!target || target.size !== source.size) {
    logger.error(
      { from, storageKey, sourceBytes: source.size, copiedBytes: target?.size },
      "A legacy upload did not arrive intact at its new key; aborting the " +
        "migration with the legacy tables and files intact",
    );
    throw new Error(
      `Migration aborted: legacy upload ${from} did not copy intact to ${storageKey}`,
    );
  }
}

/**
 * Best-effort by design. Each file is already duplicated at a key the database
 * knows about, so a failed removal costs disk and nothing else.
 */
function removeLegacyOriginals(copied: CopiedUpload[]): void {
  for (const { from, storageKey } of copied) {
    try {
      fs.unlinkSync(from);
    } catch (error) {
      logger.warn(
        { error, from, storageKey },
        "Migrated upload copied successfully but the legacy file could not " +
          "be removed; it is a duplicate and safe to delete by hand",
      );
    }
  }
}

/**
 * Columns absent from the legacy table are filled: `tenant_id` and
 * `channel_account_id` with the single tenant's ids, `audit_log.actor` from the
 * row's user, and everything else by its schema default.
 */
function copyTable(
  db: Database,
  table: string,
  legacyCols: string[],
  tenantId: string,
  channelAccountId: string,
): void {
  const newCols = (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      hidden?: number;
    }>
  )
    .map((c) => c.name)
    .filter((n) => n !== "current_state");

  const shared = legacyCols.filter((c) => newCols.includes(c));

  const targets: string[] = [...shared];
  const sources: string[] = [...shared.map((c) => `l.${c}`)];

  // The ids are bound as parameters, not pasted into the statement. Nothing
  // here is attacker-supplied today, but the copy must not depend on that.
  const params: string[] = [];

  if (newCols.includes("tenant_id") && !shared.includes("tenant_id")) {
    targets.push("tenant_id");
    sources.push("?");
    params.push(tenantId);
  }
  if (
    newCols.includes("channel_account_id") &&
    !shared.includes("channel_account_id")
  ) {
    targets.push("channel_account_id");
    sources.push("?");
    params.push(channelAccountId);
  }

  // Every legacy audit row was written by a user, so that user is its actor.
  if (table === "audit_log" && !shared.includes("actor")) {
    targets.push("actor");
    sources.push("'user:' || l.user_id");
  }

  // `orders.conversation_phone` and `messages.phone_number` keep their names,
  // so the shared-column copy already carries them.
  db.prepare(
    `INSERT INTO ${table} (${targets.join(", ")})
     SELECT ${sources.join(", ")} FROM ${table}_legacy l`,
  ).run(...params);

  const copied = (
    db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
      count: number;
    }
  ).count;

  logger.debug({ table, rows: copied }, "Copied table");
}

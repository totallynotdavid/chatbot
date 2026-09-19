/**
 * Migration from the single-business schema to the multi-tenant one.
 *
 * A database written before tenancy has no `tenants` table and no `tenant_id`
 * columns. Every row in it belongs to exactly one business (Totem) on exactly
 * one WhatsApp number (the WHATSAPP_* environment variables), so the migration
 * is: create that tenant and its channel account, then stamp every existing row
 * with them.
 *
 * Several tables change primary key (`conversations` most of all), which SQLite
 * cannot do in place. The approach is the standard rebuild: rename the old
 * tables aside, create the new shape from schema.sql, copy the rows across with
 * the tenant columns filled in, and drop the originals - all inside one
 * transaction, so a failure leaves the database untouched.
 *
 * The result is byte-identical behaviour for that one tenant: same
 * conversations, same messages, same catalog, same orders, now addressed by
 * (tenant, channel account, phone number) instead of phone number alone.
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

function columnExists(db: Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return columns.some((c) => c.name === column);
}

/**
 * A legacy database is one whose conversations table is still keyed by phone
 * number alone. The `conversations.tenant_id` column is the only signal used:
 * an empty `tenants` table can exist alongside legacy data if a previous run
 * applied part of the new schema before stopping, and that state still needs
 * migrating rather than another failing schema pass.
 */
export function needsTenantMigration(db: Database): boolean {
  if (!tableExists(db, "conversations")) return false;
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

  // The database is committed and every legacy upload is readable at its new
  // key, so the originals are now duplicates. Removing them is the last step
  // and the only one allowed to fail quietly: a leftover file wastes disk,
  // where removing it any earlier would have destroyed the copy source that
  // makes a failed migration retryable.
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
      // 1. Move the legacy tables aside, with their indexes, so schema.sql can
      //    create the new shape under the original names.
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

      // 2. Create the new schema.
      runSchema(db);

      // 3. The single tenant and the single channel account everything belonged
      //    to. This is the same seed a fresh database gets, so the migrated
      //    business ends up with its WHATSAPP_* credentials imported and
      //    encrypted - a number it can actually send from, not a placeholder
      //    row the adapter would refuse.
      const { tenant, channelAccount } = seedTenants(db);
      const tenantId = tenant.id;
      const channelAccountId = channelAccount.id;

      // 4. Copy each table across, stamping the tenant columns.
      for (const table of present) {
        const columns = legacyColumns(db, table);
        copyTable(db, table, columns, tenantId, channelAccountId);
      }

      // 5. Every pre-existing user becomes a member of the one tenant, keeping
      //    the role they already had, and the availability they had set.
      if (present.includes("users")) {
        migrateMemberships(db, tenantId);
      }

      // 6. Sessions carried over from before tenancy have no active tenant.
      //    They need the one login would have given them, or everybody still
      //    logged in when the deployment happens loses their scope.
      if (present.includes("session")) {
        backfillSessionTenants(db);
      }

      // 7. Uploaded contracts and recordings become private asset rows before
      //    the legacy conversation columns disappear. This copies the files
      //    rather than moving them and throws if a copy fails, so the
      //    transaction below can still roll back onto intact legacy data.
      const copiedFiles = migrateRecordings(db, tenantId, channelAccountId);

      // 8. Drop the originals.
      for (const table of present) {
        db.run(`DROP TABLE ${table}_legacy`);
      }

      return { tenant, channelAccount, copiedFiles };
    })();
  }
}

/**
 * Every pre-existing user becomes a member of the one tenant. Availability used
 * to be a global flag on the account; it belongs to the membership now, so an
 * agent who had switched themselves off stays off in the tenant they were
 * working in.
 */
function migrateMemberships(db: Database, tenantId: string): void {
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
 * Sessions predating tenancy carry no active tenant, and a session with none is
 * unscoped: `requireTenantScope` answers 403, and the dashboard only offers a
 * tenant picker to someone who belongs to more than one. An ordinary user
 * logged in across the deployment would have found the application shut to them
 * with no way back in but to log out - so the migration gives every carried-over
 * session the scope a fresh login would have given it.
 *
 * The rule is `defaultTenantForUser`, restated in SQL and deliberately
 * identical: a platform operator gets none (their scope is chosen, not
 * implied), somebody with exactly one membership gets that one, and somebody
 * with several gets none because only they can say which. Migrating from a
 * single-business database means everyone is in the middle case, but the rule
 * is written out in full rather than assumed, so it stays right if this ever
 * runs against a database that already has more than one tenant. It is
 * exported so that rule can be tested against each of its three cases, which a
 * single-business legacy database cannot produce on its own.
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

/** A legacy upload copied into private storage, and where it came from. */
type CopiedUpload = { from: string; storageKey: string };

/**
 * A legacy upload's absolute path, or null when the stored value escapes the
 * directory legacy uploads live in.
 *
 * `recording_contract_path` and `recording_audio_path` were never validated on
 * the way in, so their contents are input, not data: an absolute path or one
 * with enough `../` resolves anywhere the process can read. This is the same
 * containment check `privateFilePath` makes on the writing side, applied to the
 * reading side.
 *
 * A path that stays inside by its spelling can still leave through a symbolic
 * link, in the file itself or in any directory above it, and copying follows
 * links. So a file that exists is contained only if its real path is inside the
 * real legacy root, and the real path is what is returned for copying. A path
 * that does not exist has nothing to read and is returned as spelled, for the
 * caller to report missing.
 */
export function resolveLegacyUpload(
  legacyRoot: string,
  legacyPath: string,
): string | null {
  const resolved = path.resolve(legacyRoot, legacyPath);

  if (!isInside(legacyRoot, resolved)) return null;
  if (!fs.existsSync(resolved)) return resolved;

  const real = fs.realpathSync(resolved);
  return isInside(fs.realpathSync(legacyRoot), real) ? real : null;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Contracts used to be tracked as bare paths on the conversation and written
 * under `data/contracts/<phone>/`. They become private assets under the
 * tenant's private prefix.
 *
 * The file is **copied**, not moved, and the copy is verified before the asset
 * row claims it. Two failures used to be swallowed here, and both ended with a
 * row asserting that a signed contract lived at a key holding nothing:
 *
 *  - a failed copy (permissions, a full disk, a transient fault) was logged and
 *    the migration carried on to drop the legacy tables, so the only remaining
 *    record of where the bytes actually were went with them;
 *  - even a clean move is wrong inside a transaction that can still roll back -
 *    the database would return to the legacy shape while the file it names had
 *    already been renamed away.
 *
 * So a copy that fails throws, which aborts the whole migration with the legacy
 * tables and the legacy files both untouched and the run repeatable. The
 * originals are deleted by `removeLegacyOriginals` once the transaction has
 * committed.
 *
 * A source file that is *already* missing is the one case that does not abort:
 * the bytes were gone before this ran, the asset row is the surviving record
 * that the upload happened, and refusing to migrate would make the deployment
 * permanently unmigratable over damage that predates it. It is logged as an
 * error, not a warning.
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

      // The same key builder every other write to private storage uses. The
      // legacy path is a column nothing ever validated, so each of its segments
      // is sanitised rather than pasted into a path: `..` and anything else
      // that could climb out of the tenant's directory becomes an underscore.
      const storageKey = privateStorageKey(
        tenantId,
        "legacy",
        ...legacyPath.split("/"),
      );
      const id = crypto.randomUUID();

      // The destination is sanitised above; the source has to be too, and
      // before anything touches the filesystem. `legacyPath` is the same
      // unvalidated column, and `path.join` happily walks out of `data/` on
      // enough `../` - which would copy an arbitrary readable host file into
      // the tenant's private storage and hand it back from /api/assets/:id.
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
 * Copy one legacy upload to its private storage key, and prove it arrived.
 *
 * Everything here throws rather than logs. The caller runs inside the migration
 * transaction, so a throw rolls the database back to the legacy shape - which
 * is the correct outcome, because the legacy file is still where it was and the
 * whole migration can simply be run again once the cause is dealt with. The
 * alternative this replaced was an asset row pointing at a key with nothing
 * behind it, and no legacy table left to say where the bytes really went.
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
 * Drop the legacy copies once the migration has committed. Best-effort by
 * design: every one of these files is now duplicated at a key the database
 * knows about, so failing to remove one costs disk and nothing else.
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
 * Column-by-column copy. New columns absent from the legacy table are filled:
 * `tenant_id` / `channel_account_id` with the single tenant's ids, everything
 * else by its schema default.
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

  // The ids are bound, not pasted into the statement: they are values, and the
  // rest of this file binds its values too. Nothing here is attacker-supplied
  // today, and this is not the place to depend on that staying true.
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

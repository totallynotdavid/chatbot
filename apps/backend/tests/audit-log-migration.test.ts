/** Rebuilding `audit_log` on a database created before it had an `actor`. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db as applicationDb } from "../src/db/index.ts";
import { initializeDatabase } from "../src/db/init.ts";
import { migrateAuditLogActor } from "../src/db/migrations.ts";
import { createTestDatabase } from "./helpers/database.ts";
import { startTogether } from "./helpers/start-together.ts";

const SCHEMA = fs.readFileSync(
  join(import.meta.dir, "..", "src", "db", "schema.sql"),
  "utf-8",
);

const OLD_AUDIT_LOG = `
CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
`;

type Column = { name: string; notnull: number };

describe("rebuilding audit_log with an actor", () => {
  let dir: string;
  let db: Database;
  let tenantId: string;

  const columns = (): Column[] =>
    db.prepare("PRAGMA table_info(audit_log)").all() as Column[];

  const rows = () =>
    db.prepare("SELECT * FROM audit_log ORDER BY id").all() as Array<
      Record<string, unknown>
    >;

  const indexes = () =>
    (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_log' AND name LIKE 'idx_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((index) => index.name);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-audit-migration-"));
    db = createTestDatabase(join(dir, "audit.sqlite"));
    db.run("PRAGMA foreign_keys = ON;");
    initializeDatabase(db);

    tenantId = "tn-1";
    db.prepare(
      "INSERT INTO tenants (id, slug, name, status) VALUES (?, 'one', 'One', 'active')",
    ).run(tenantId);
    for (const id of ["u-1", "u-2"]) {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, name)
         VALUES (?, ?, 'x', 'admin', ?)`,
      ).run(id, id, id);
    }

    db.run("DROP TABLE audit_log");
    db.run(OLD_AUDIT_LOG);

    const insert = db.prepare(
      `INSERT INTO audit_log (id, tenant_id, user_id, action, resource_type, resource_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      "a1",
      tenantId,
      "u-1",
      "create_product",
      "product",
      "p1",
      '{"k":1}',
      1000,
    );
    insert.run(
      "a2",
      null,
      "u-2",
      "update_settings",
      "system",
      null,
      "{}",
      2000,
    );
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps every row, and names each row's user as its actor", () => {
    const before = rows();

    initializeDatabase(db);

    expect(rows()).toEqual(
      before.map((row) => ({ ...row, actor: `user:${row.user_id}` })),
    );
  });

  it("makes user_id nullable and actor required, and keeps the user reference", () => {
    initializeDatabase(db);

    const byName = Object.fromEntries(columns().map((c) => [c.name, c]));
    expect(byName.user_id!.notnull).toBe(0);
    expect(byName.tenant_id!.notnull).toBe(0);
    expect(byName.actor!.notnull).toBe(1);

    const references = db
      .prepare("PRAGMA foreign_key_list(audit_log)")
      .all() as Array<{ table: string; from: string }>;
    expect(references.map((r) => [r.from, r.table]).sort()).toEqual([
      ["tenant_id", "tenants"],
      ["user_id", "users"],
    ]);
  });

  it("accepts a row with no user afterwards", () => {
    initializeDatabase(db);

    db.prepare(
      `INSERT INTO audit_log (id, actor, action, resource_type)
       VALUES ('a3', 'cli:someone', 'create_user', 'user')`,
    ).run();

    expect(rows()).toHaveLength(3);
  });

  it("recreates the indexes and leaves no table behind", () => {
    initializeDatabase(db);

    expect(indexes()).toEqual(["idx_audit_tenant", "idx_audit_user"]);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'audit_log_legacy'",
        )
        .get(),
    ).toBeNull();
  });

  it("moves an index the schema does not define onto the new table", () => {
    db.run(
      "CREATE UNIQUE INDEX hand_unique ON audit_log(action, resource_id, created_at)",
    );
    db.run('CREATE INDEX "hand plain" ON audit_log(resource_type)');

    initializeDatabase(db);

    const names = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_log' AND sql IS NOT NULL ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((index) => index.name);
    expect(names).toEqual([
      "hand plain",
      "hand_unique",
      "idx_audit_tenant",
      "idx_audit_user",
    ]);
    expect(() =>
      db
        .prepare(
          `INSERT INTO audit_log (id, tenant_id, user_id, actor, action, resource_type, resource_id, created_at)
           VALUES ('dup', ?, 'u-1', 'user:u-1', 'create_product', 'product', 'p1', 1000)`,
        )
        .run(tenantId),
    ).toThrow();
  });

  it("changes nothing the second time", () => {
    initializeDatabase(db);
    const once = rows();

    initializeDatabase(db);

    expect(rows()).toEqual(once);
    expect(indexes()).toEqual(["idx_audit_tenant", "idx_audit_user"]);
  });

  it("changes nothing on a table that already has the new shape", () => {
    initializeDatabase(db);
    db.prepare(
      `INSERT INTO audit_log (id, actor, action, resource_type)
       VALUES ('a3', 'cli:someone', 'create_user', 'user')`,
    ).run();
    const before = rows();

    migrateAuditLogActor(db, () => {
      throw new Error("the schema must not be applied");
    });

    expect(rows()).toEqual(before);
  });

  it("does nothing on a database with no audit_log", () => {
    db.run("DROP TABLE audit_log");

    migrateAuditLogActor(db, () => {
      throw new Error("the schema must not be applied");
    });

    expect(columns()).toEqual([]);
  });

  describe("when the rebuild fails", () => {
    const failing = (applied: boolean) => (database: Database) => {
      if (applied) database.run(SCHEMA);
      throw new Error("boom");
    };

    it.each([
      ["before the new table exists", false],
      ["after the new table exists", true],
    ])("leaves the old table and its rows untouched, %s", (_, applied) => {
      const before = rows();

      expect(() => migrateAuditLogActor(db, failing(applied))).toThrow("boom");

      expect(columns().map((c) => c.name)).not.toContain("actor");
      expect(rows()).toEqual(before);
      expect(indexes()).toEqual(["idx_audit_tenant", "idx_audit_user"]);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name = 'audit_log_legacy'",
          )
          .get(),
      ).toBeNull();
    });

    it("keeps foreign keys enforced, and succeeds when retried", () => {
      expect(() => migrateAuditLogActor(db, failing(true))).toThrow();
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({
        foreign_keys: 1,
      });

      initializeDatabase(db);

      expect(rows().map((row) => row.actor)).toEqual(["user:u-1", "user:u-2"]);
    });
  });
});

describe("two processes booting on a database with the old audit_log", () => {
  const ROWS = 100_000;
  const CHILD = join(import.meta.dir, "helpers", "init-database-child.ts");
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-audit-race-"));
    dbPath = join(dir, "race.sqlite");

    const db = createTestDatabase(dbPath);
    db.run("PRAGMA journal_mode = WAL;");
    initializeDatabase(db);
    db.run("DROP TABLE audit_log");
    db.run(OLD_AUDIT_LOG);
    db.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, metadata, created_at)
       SELECT 'a' || i, 'u-' || (i % 5), 'create_product', 'product', 'p' || i, '{}', i FROM n`,
    ).run(ROWS);
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const boot = (mode: "init" | "migrate") =>
    startTogether({ dir, dbPath, script: CHILD, args: [mode] });

  function migrated() {
    const db = createTestDatabase(dbPath);
    try {
      return {
        rows: (
          db.prepare("SELECT COUNT(*) AS c FROM audit_log").get() as {
            c: number;
          }
        ).c,
        unnamed: (
          db
            .prepare(
              "SELECT COUNT(*) AS c FROM audit_log WHERE actor != 'user:' || user_id",
            )
            .get() as { c: number }
        ).c,
        legacy: db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name = 'audit_log_legacy'",
          )
          .get(),
      };
    } finally {
      db.close();
    }
  }

  it("both start successfully and every row is migrated once", async () => {
    const results = await boot("init");

    expect(results.map((r) => [r.code, r.stderr])).toEqual([
      [0, ""],
      [0, ""],
    ]);
    expect(migrated()).toEqual({ rows: ROWS, unnamed: 0, legacy: null });
  }, 20_000);

  it("rebuilds the table in one of them only", async () => {
    const results = await boot("migrate");

    expect(results.map((r) => r.code)).toEqual([0, 0]);
    expect(
      results
        .map((r) => r.stdout.split("\n").find((l) => l.startsWith("rebuilds")))
        .sort(),
    ).toEqual(["rebuilds 0", "rebuilds 1"]);
    expect(migrated()).toEqual({ rows: ROWS, unnamed: 0, legacy: null });
  }, 20_000);
});

describe("the application connection", () => {
  it("waits for a lock instead of failing at once", () => {
    const { timeout } = applicationDb.prepare("PRAGMA busy_timeout").get() as {
      timeout: number;
    };

    expect(timeout).toBeGreaterThan(0);
  });
});

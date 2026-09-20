/** Several processes opening the same SQLite file at once, as a deploy restart beside `bun run account` does. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { needsTenantMigration } from "../src/db/migrations.ts";
import { enableWal } from "../src/db/wal.ts";
import { createTestDatabase } from "./helpers/database.ts";
import { LEGACY_SCHEMA } from "./helpers/legacy-schema.ts";
import { startTogether } from "./helpers/start-together.ts";

const HELPERS = join(import.meta.dir, "helpers");

const scalar = (db: Database, sql: string) =>
  (db.prepare(sql).get() as { n: number }).n;

describe("processes booting on a database from before tenancy", () => {
  const CONVERSATIONS = 40;
  const MESSAGES = 60_000;
  const CHILD = join(HELPERS, "init-database-child.ts");
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-tenant-race-"));
    dbPath = join(dir, "race.sqlite");

    const db = createTestDatabase(dbPath);
    db.run("PRAGMA journal_mode = WAL;");
    db.run(LEGACY_SCHEMA);
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, name)
       VALUES ('admin-001', 'admin', 'x', 'admin', 'Admin')`,
    ).run();

    // Legacy uploads are read from `data/` under the child's working directory.
    for (let i = 0; i < CONVERSATIONS; i++) {
      const phone = `519${String(i).padStart(8, "0")}`;
      const folder = join(dir, "data", "contracts", phone);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "contract.pdf"), `contract ${phone}`);
      writeFileSync(join(folder, "audio.mp3"), `audio ${phone}`);
      db.prepare(
        `INSERT INTO conversations
           (phone_number, context_data, recording_contract_path, recording_audio_path)
         VALUES (?, '{}', ?, ?)`,
      ).run(
        phone,
        `contracts/${phone}/contract.pdf`,
        `contracts/${phone}/audio.mp3`,
      );
    }

    // Enough rows that the copy takes longer than the gap between the two
    // processes' first read of the file.
    db.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO messages (id, phone_number, direction, type, content, created_at)
       SELECT 'm' || i, '519' || printf('%08d', i % ?), 'inbound', 'text', 'hola ' || i, i FROM n`,
    ).run(MESSAGES, CONVERSATIONS);
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const boot = (mode: "init" | "migrate-tenants", count = 2) =>
    startTogether({ dir, dbPath, script: CHILD, args: [mode], count });

  function migrated() {
    const db = createTestDatabase(dbPath);
    try {
      const assets = db
        .prepare("SELECT storage_key FROM assets")
        .all() as Array<{ storage_key: string }>;
      return {
        needsMigration: needsTenantMigration(db),
        tenants: scalar(db, "SELECT COUNT(*) AS n FROM tenants"),
        conversations: scalar(db, "SELECT COUNT(*) AS n FROM conversations"),
        messages: scalar(db, "SELECT COUNT(*) AS n FROM messages"),
        assets: assets.length,
        copiedFiles: assets.filter((a) =>
          existsSync(join(dir, "private", a.storage_key)),
        ).length,
        legacyTables: scalar(
          db,
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%_legacy'",
        ),
        legacyFilesLeft: Array.from({ length: CONVERSATIONS }, (_, i) =>
          existsSync(
            join(
              dir,
              "data",
              "contracts",
              `519${String(i).padStart(8, "0")}`,
              "contract.pdf",
            ),
          ),
        ).filter(Boolean).length,
      };
    } finally {
      db.close();
    }
  }

  const MIGRATED_ONCE = {
    needsMigration: false,
    tenants: 1,
    conversations: CONVERSATIONS,
    messages: MESSAGES,
    assets: CONVERSATIONS * 2,
    copiedFiles: CONVERSATIONS * 2,
    legacyTables: 0,
    legacyFilesLeft: 0,
  };

  it("both start successfully and the data is migrated once", async () => {
    const results = await boot("init");

    expect(results.map((r) => [r.code, r.stderr])).toEqual([
      [0, ""],
      [0, ""],
    ]);
    expect(migrated()).toEqual(MIGRATED_ONCE);
  }, 20_000);

  it("runs the migration in one of them only", async () => {
    const results = await boot("migrate-tenants");

    expect(results.map((r) => [r.code, r.stderr])).toEqual([
      [0, ""],
      [0, ""],
    ]);
    expect(
      results
        .map((r) => r.stdout.split("\n").find((l) => l.startsWith("rebuilds")))
        .sort(),
    ).toEqual(["rebuilds 0", "rebuilds 1"]);
    expect(migrated()).toEqual(MIGRATED_ONCE);
  }, 20_000);
});

describe("processes creating a database that does not exist", () => {
  const HELD_MS = 400;
  const ROUNDS = 40;
  const ROUND_MS = 30;
  const CHILDREN = 3;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-fresh-race-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("wait for the process that is switching the file to WAL", async () => {
    // A connection that holds the write lock stands in for the process that
    // is inside its own switch to WAL.
    const file = join(dir, "fresh", "0", "db.sqlite");
    mkdirSync(join(dir, "fresh", "0"), { recursive: true });
    const holder = createTestDatabase(file);
    holder.run("BEGIN IMMEDIATE");

    try {
      const started = performance.now();
      const results = await startTogether({
        dir,
        dbPath: join(dir, "fresh", "db.sqlite"),
        script: join(HELPERS, "fresh-start-child.ts"),
        args: ["1", "0"],
        count: CHILDREN,
        afterRelease: async () => {
          await Bun.sleep(HELD_MS);
          holder.run("ROLLBACK");
        },
      });

      expect(results.map((r) => [r.code, r.stderr])).toEqual(
        Array.from({ length: CHILDREN }, () => [0, ""]),
      );
      expect(performance.now() - started).toBeGreaterThanOrEqual(HELD_MS);
    } finally {
      holder.close();
    }

    const db = createTestDatabase(file);
    try {
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "wal",
      });
    } finally {
      db.close();
    }
  }, 20_000);

  it("all start successfully, in WAL mode, with the schema in place", async () => {
    const results = await startTogether({
      dir,
      dbPath: join(dir, "fresh", "db.sqlite"),
      script: join(HELPERS, "fresh-start-child.ts"),
      args: [String(ROUNDS), String(ROUND_MS)],
      count: CHILDREN,
    });

    expect(results.map((r) => [r.code, r.stderr])).toEqual(
      Array.from({ length: CHILDREN }, () => [0, ""]),
    );

    for (let round = 0; round < ROUNDS; round++) {
      const db = createTestDatabase(
        join(dir, "fresh", String(round), "db.sqlite"),
      );
      try {
        expect(db.prepare("PRAGMA journal_mode").get()).toEqual({
          journal_mode: "wal",
        });
        expect(
          scalar(
            db,
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'conversations'",
          ),
        ).toBe(1);
      } finally {
        db.close();
      }
    }
  }, 20_000);
});

describe("switching a file to WAL while another connection holds the write lock", () => {
  let dir: string;
  let holder: Database;
  let switching: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-wal-lock-"));
    const path = join(dir, "wal.sqlite");
    holder = createTestDatabase(path);
    switching = createTestDatabase(path);
    switching.run("PRAGMA busy_timeout = 10000;");
    holder.run("BEGIN IMMEDIATE");
  });

  afterEach(() => {
    holder.close();
    switching.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives up with the busy error once the time is spent", () => {
    const started = performance.now();

    expect(() => enableWal(switching, 300)).toThrow(
      expect.objectContaining({ code: "SQLITE_BUSY" }),
    );

    const waited = performance.now() - started;
    expect(waited).toBeGreaterThanOrEqual(300);
    expect(waited).toBeLessThan(2000);
  });

  it("changes nothing on a file that is already in WAL", () => {
    holder.run("ROLLBACK");
    holder.run("PRAGMA journal_mode = WAL");
    holder.run("BEGIN IMMEDIATE");

    enableWal(switching, 300);

    expect(switching.prepare("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
  });
});

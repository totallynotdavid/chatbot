/**
 * The test commands load the repository's .env, so the application's connection
 * would open a developer's real database. `applySchema` migrates it and the fixtures
 * insert and delete rows in it. `tests/setup.ts` prevents that by pointing
 * DB_PATH at a throwaway file.
 */

import { describe, it, expect } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { db } from "../src/db/index.ts";
import { createTestDatabase } from "./helpers/database.ts";
import { applySchema } from "./helpers/tenancy.ts";

describe("the database the tests run against", () => {
  it("is a throwaway file, not the configured one", () => {
    const dbPath = path.resolve(db.filename);

    expect(dbPath.startsWith(path.resolve(tmpdir()) + path.sep)).toBe(true);
    expect(dbPath).not.toBe(
      path.resolve(process.cwd(), "data", "database.sqlite"),
    );
  });

  it("is the one DB_PATH names, so every module opens the same file", () => {
    expect(path.resolve(process.env.DB_PATH ?? "")).toBe(
      path.resolve(db.filename),
    );
  });

  it("is safe for applySchema to migrate", () => {
    applySchema();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables.map((t) => t.name)).toContain("tenants");
  });
});

/** Lines that open a database file the test can write to without the helper. */
function unsyncedFileDatabases(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => line.includes("new Database("))
    .filter((line) => !line.includes(":memory:"))
    .filter((line) => !line.includes("readonly: true"));
}

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return testFiles(full);
    return entry.endsWith(".ts") ? [full] : [];
  });
}

describe("the databases tests create for themselves", () => {
  it("skip the fsync after every statement", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "totem-test-db-"));
    const database = createTestDatabase(path.join(dir, "scratch.sqlite"));

    try {
      const row = database.prepare("PRAGMA synchronous").get() as {
        synchronous: number;
      };

      expect(row.synchronous).toBe(0);
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("are all opened through createTestDatabase", () => {
    const helper = path.join(import.meta.dir, "helpers", "database.ts");
    const offenders = testFiles(import.meta.dir)
      .filter((file) => file !== helper && file !== import.meta.path)
      .flatMap((file) =>
        unsyncedFileDatabases(readFileSync(file, "utf8")).map(
          (line) => `${path.relative(import.meta.dir, file)}: ${line.trim()}`,
        ),
      );

    expect(offenders).toEqual([]);
  });

  it("are told apart from in-memory and read-only ones by the check above", () => {
    expect(
      unsyncedFileDatabases('db = new Database(join(dir, "a.sqlite"));'),
    ).toHaveLength(1);
    expect(
      unsyncedFileDatabases("new Database(p, { create: true })"),
    ).toHaveLength(1);
    expect(unsyncedFileDatabases('new Database(":memory:")')).toHaveLength(0);
    expect(
      unsyncedFileDatabases("new Database(p, { readonly: true })"),
    ).toHaveLength(0);
  });
});

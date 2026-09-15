/**
 * The suite's own database.
 *
 * `bun test` runs with the repository's real .env, and the application's
 * connection opens DB_PATH - a developer's actual database unless something
 * says otherwise. `applySchema` migrates whatever it is handed (rename aside,
 * rebuild, copy, drop) and the fixtures insert and delete rows through that
 * same connection, so running the suite against it would rewrite real data.
 * tests/setup.ts, preloaded by bunfig.toml, is what keeps that from happening.
 */

import { describe, it, expect } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { db } from "../src/db/index.ts";
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

/** Adding the turn counters to a `message_inbox` that predates them. */

import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { migrateInboxTurnRecovery } from "../src/db/migrations.ts";

describe("migrating message_inbox for turn recovery", () => {
  function oldInbox(): Database {
    const db = new Database(":memory:");
    db.run(`CREATE TABLE message_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pending',
      last_error TEXT,
      created_at INTEGER NOT NULL
    )`);
    for (const [id, status] of [
      ["a", "failed"],
      ["b", "pending"],
      ["c", "processed"],
    ] as const) {
      db.prepare(
        "INSERT INTO message_inbox (message_id, status, created_at) VALUES (?, ?, 1000)",
      ).run(id, status);
    }
    return db;
  }

  const rows = (db: Database) =>
    db
      .prepare(
        "SELECT message_id, attempts, handed_off_at FROM message_inbox ORDER BY id",
      )
      .all();

  it("stamps the rows that failed before, so no old customer is alerted", () => {
    const db = oldInbox();

    migrateInboxTurnRecovery(db);

    expect(rows(db)).toEqual([
      { message_id: "a", attempts: 0, handed_off_at: 1000 },
      { message_id: "b", attempts: 0, handed_off_at: null },
      { message_id: "c", attempts: 0, handed_off_at: null },
    ]);
  });

  it("leaves a row that fails afterwards owed a handoff", () => {
    const db = oldInbox();
    migrateInboxTurnRecovery(db);
    db.run("UPDATE message_inbox SET status = 'failed' WHERE message_id = 'b'");

    migrateInboxTurnRecovery(db);

    expect(rows(db)[1]).toEqual({
      message_id: "b",
      attempts: 0,
      handed_off_at: null,
    });
  });
});

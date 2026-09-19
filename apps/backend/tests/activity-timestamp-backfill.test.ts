/** Boot converts text `conversations.last_activity_at` values to epoch milliseconds. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeDatabase } from "../src/db/init.ts";
import { backfillTextActivityTimestamps } from "../src/db/migrations.ts";

const ISO = "2026-03-10T15:00:00.123Z";
const SQLITE_TEXT = "2026-03-10 15:00:00";
const UNPARSEABLE = "yesterday afternoon";
const INTEGER_MS = Date.parse("2026-01-05T08:30:00.000Z");

describe("backfilling text activity timestamps", () => {
  let db: Database;

  function insert(phone: string, lastActivityAt: string | number): void {
    db.prepare(
      `INSERT INTO conversations
         (tenant_id, channel_account_id, phone_number, context_data, last_activity_at)
       VALUES ('tn-1', 'ch-1', ?, '{}', ?)`,
    ).run(phone, lastActivityAt);
  }

  function stored(phone: string): unknown {
    return (
      db
        .prepare(
          "SELECT last_activity_at FROM conversations WHERE phone_number = ?",
        )
        .get(phone) as { last_activity_at: unknown }
    ).last_activity_at;
  }

  function snapshot(): unknown[] {
    return db
      .prepare(
        "SELECT phone_number, last_activity_at, typeof(last_activity_at) as kind FROM conversations ORDER BY phone_number",
      )
      .all();
  }

  beforeEach(() => {
    db = new Database(":memory:");
    initializeDatabase(db);
    insert("iso", ISO);
    insert("sqlite-text", SQLITE_TEXT);
    insert("integer", INTEGER_MS);
    insert("unparseable", UNPARSEABLE);
  });

  afterEach(() => {
    db.close();
  });

  it("converts an ISO row to milliseconds, keeping the milliseconds", () => {
    backfillTextActivityTimestamps(db);

    expect(stored("iso")).toBe(Date.parse(ISO));
  });

  it("converts a CURRENT_TIMESTAMP-format row, read as UTC", () => {
    backfillTextActivityTimestamps(db);

    expect(stored("sqlite-text")).toBe(Date.parse("2026-03-10T15:00:00Z"));
  });

  it("leaves an integer row unchanged", () => {
    backfillTextActivityTimestamps(db);

    expect(stored("integer")).toBe(INTEGER_MS);
  });

  it("leaves an unparseable row as it is, without throwing", () => {
    expect(() => backfillTextActivityTimestamps(db)).not.toThrow();

    expect(stored("unparseable")).toBe(UNPARSEABLE);
  });

  it("changes nothing on a second run", () => {
    backfillTextActivityTimestamps(db);
    const afterFirst = snapshot();

    backfillTextActivityTimestamps(db);

    expect(snapshot()).toEqual(afterFirst);
  });

  it("runs as part of initialising the database", () => {
    initializeDatabase(db);

    expect(stored("iso")).toBe(Date.parse(ISO));
    expect(stored("unparseable")).toBe(UNPARSEABLE);
  });
});

/** Boot turns every text `conversations.last_activity_at` value into epoch milliseconds. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { initializeDatabase } from "../src/db/init.ts";
import { backfillTextActivityTimestamps } from "../src/db/migrations.ts";

const ISO = "2026-03-10T15:00:00.123Z";
const SQLITE_TEXT = "2026-03-10 15:00:00";
const UNPARSEABLE = "yesterday afternoon";
const INTEGER_MS = Date.parse("2026-01-05T08:30:00.000Z");
const NEWEST_MESSAGE_MS = Date.parse("2026-02-01T10:00:00.000Z");

describe("backfilling text activity timestamps", () => {
  let db: Database;

  function insert(phone: string, lastActivityAt: string | number): void {
    db.prepare(
      `INSERT INTO conversations
         (tenant_id, channel_account_id, phone_number, context_data, last_activity_at)
       VALUES ('tn-1', 'ch-1', ?, '{}', ?)`,
    ).run(phone, lastActivityAt);
  }

  function insertMessage(phone: string, id: string, createdAt: number): void {
    db.prepare(
      `INSERT INTO messages
         (id, tenant_id, channel_account_id, phone_number, direction, type, content, created_at)
       VALUES (?, 'tn-1', 'ch-1', ?, 'inbound', 'text', 'hola', ?)`,
    ).run(id, phone, createdAt);
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
    insert("unparseable-with-messages", UNPARSEABLE);
    insert("newer-messages-elsewhere", INTEGER_MS);
    insertMessage("unparseable-with-messages", "m1", NEWEST_MESSAGE_MS - 5000);
    insertMessage("unparseable-with-messages", "m2", NEWEST_MESSAGE_MS);
    insertMessage("unparseable-with-messages", "m3", NEWEST_MESSAGE_MS - 9000);
    insertMessage("newer-messages-elsewhere", "m4", NEWEST_MESSAGE_MS + 60_000);
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

  it("gives an unparseable row the time of its newest message", () => {
    backfillTextActivityTimestamps(db);

    expect(stored("unparseable-with-messages")).toBe(NEWEST_MESSAGE_MS);
  });

  it("gives an unparseable row with no messages the time zero", () => {
    backfillTextActivityTimestamps(db);

    expect(stored("unparseable")).toBe(0);
  });

  it("ignores a message time that is not a number", () => {
    db.prepare("UPDATE messages SET created_at = ? WHERE id = 'm2'").run(
      "2026-02-01",
    );

    backfillTextActivityTimestamps(db);

    expect(stored("unparseable-with-messages")).toBe(NEWEST_MESSAGE_MS - 5000);
  });

  it("leaves no text value in the column", () => {
    backfillTextActivityTimestamps(db);

    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM conversations WHERE typeof(last_activity_at) != 'integer'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it("leaves an integer row unchanged beside messages newer than it", () => {
    backfillTextActivityTimestamps(db);

    expect(stored("newer-messages-elsewhere")).toBe(INTEGER_MS);
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
    expect(stored("unparseable")).toBe(0);
    expect(stored("unparseable-with-messages")).toBe(NEWEST_MESSAGE_MS);
  });
});

describe("the warning about replaced activity timestamps", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-backfill-log-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("names how many conversations were replaced", async () => {
    const child = Bun.spawn(
      ["bun", "run", join(import.meta.dir, "helpers", "backfill-child.ts")],
      {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          NODE_ENV: "test",
          DB_PATH: join(dir, "db.sqlite"),
          UPLOAD_DIR: join(dir, "uploads"),
          PRIVATE_DIR: join(dir, "private"),
        },
      },
    );
    const [stderr, code] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect([code, stderr]).toEqual([0, ""]);

    const warnings = readFileSync(
      join(dir, "data", "logs", "backend.log"),
      "utf-8",
    )
      .split("\n")
      .filter(Boolean)
      .map(
        (line) => JSON.parse(line) as { level: number; conversations?: number },
      )
      .filter((entry) => entry.level === 40);
    expect(warnings.map((entry) => entry.conversations)).toEqual([2]);
  });
});

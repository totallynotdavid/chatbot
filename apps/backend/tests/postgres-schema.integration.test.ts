import { beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import process from "node:process";
import { sql } from "kysely";
import {
  createTestDb,
  postgresAvailable,
  prepareTestServer,
  type TestDb,
} from "./helpers/postgres.ts";

const MIGRATE_CLI = join(import.meta.dir, "..", "src", "db", "migrate-cli.ts");
const BACKEND_ROOT = join(import.meta.dir, "..");

describe.skipIf(!postgresAvailable)("the Postgres schema", () => {
  beforeAll(prepareTestServer);

  async function migrate(url: string) {
    const child = Bun.spawn(["bun", MIGRATE_CLI], {
      cwd: BACKEND_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        DATABASE_URL: url,
      },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code };
  }

  async function tables(test: TestDb): Promise<string[]> {
    const { rows } = await sql<{ table_name: string }>`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `.execute(test.db);
    return rows.map((row) => row.table_name);
  }

  describe("db:migrate", () => {
    it("creates the schema on an empty database", async () => {
      const empty = await createTestDb({ migrated: false });
      try {
        expect(await tables(empty)).toEqual([]);

        const result = await migrate(empty.url);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain("Applied 0001_baseline.");
        expect(await tables(empty)).toContain("conversations");
      } finally {
        await empty.destroy();
      }
    });

    it("leaves a migrated database alone", async () => {
      const migrated = await createTestDb();
      try {
        const before = await tables(migrated);

        const result = await migrate(migrated.url);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain("The schema is up to date.");
        expect(await tables(migrated)).toEqual(before);
      } finally {
        await migrated.destroy();
      }
    });

    it("applies each migration once when several processes start together", async () => {
      const empty = await createTestDb({ migrated: false });
      try {
        const results = await Promise.all(
          Array.from({ length: 4 }, () => migrate(empty.url)),
        );

        expect(results.map((result) => result.code)).toEqual([0, 0, 0, 0]);
        expect(
          results.filter((result) => result.stdout.includes("Applied")),
        ).toHaveLength(1);

        const reference = await createTestDb();
        try {
          expect(await tables(empty)).toEqual(await tables(reference));
        } finally {
          await reference.destroy();
        }

        const { rows } = await sql<{ name: string }>`
          select name from kysely_migration
        `.execute(empty.db);
        expect(rows).toEqual([{ name: "0001_baseline" }]);
      } finally {
        await empty.destroy();
      }
    });

    it("fails with a message when the database cannot be reached", async () => {
      const result = await migrate("postgres://postgres@127.0.0.1:1/nothing");

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("error: migration failed");
    });
  });

  describe("the test template", () => {
    it("clones a migrated, empty database", async () => {
      const clone = await createTestDb();

      try {
        const { rows } = await sql<{ count: number }>`
          select count(*)::int as count from tenants
        `.execute(clone.db);
        expect(rows).toEqual([{ count: 0 }]);
      } finally {
        await clone.destroy();
      }
    });

    it("gives each test its own rows", async () => {
      const first = await createTestDb();
      const second = await createTestDb();
      try {
        await first.db
          .insertInto("tenants")
          .values({ id: "tn-1", slug: "one", name: "One" })
          .execute();

        const seen = await second.db
          .selectFrom("tenants")
          .select("id")
          .execute();
        expect(seen).toEqual([]);
      } finally {
        await first.destroy();
        await second.destroy();
      }
    });
  });

  describe("what the schema does on its own", () => {
    async function conversationFixture(test: TestDb) {
      const { db } = test;

      await db
        .insertInto("tenants")
        .values({ id: "tn-1", slug: "one", name: "One" })
        .execute();
      await db
        .insertInto("users")
        .values({
          id: "agent-1",
          username: "agent",
          password_hash: "x",
          role: "sales_agent",
          name: "Agent",
        })
        .execute();
      await db
        .insertInto("channel_accounts")
        .values({
          id: "ch-1",
          tenant_id: "tn-1",
          phone_number_id: "pn-1",
          label: "One",
        })
        .execute();
      await db
        .insertInto("conversations")
        .values({
          tenant_id: "tn-1",
          channel_account_id: "ch-1",
          phone_number: "+51900000000",
          context_data: JSON.stringify({
            phase: { phase: "offering_products" },
          }),
        })
        .execute();
    }

    it("derives the conversation state from its context", async () => {
      const test = await createTestDb();
      try {
        await conversationFixture(test);

        const row = await test.db
          .selectFrom("conversations")
          .select("current_state")
          .executeTakeFirstOrThrow();
        expect(row.current_state).toBe("offering_products");

        await test.db
          .updateTable("conversations")
          .set({
            context_data: JSON.stringify({ phase: { phase: "closing" } }),
          })
          .execute();

        const after = await test.db
          .selectFrom("conversations")
          .select("current_state")
          .executeTakeFirstOrThrow();
        expect(after.current_state).toBe("closing");
      } finally {
        await test.destroy();
      }
    });

    it("clears the unread alert when a conversation is assigned", async () => {
      const test = await createTestDb();
      try {
        await conversationFixture(test);
        await test.db
          .insertInto("unread_alerts")
          .values({
            tenant_id: "tn-1",
            channel_account_id: "ch-1",
            phone_number: "+51900000000",
            alerted_at: Date.now(),
          })
          .execute();

        await test.db
          .updateTable("conversations")
          .set({ assigned_agent: "agent-1" })
          .execute();

        const alerts = await test.db
          .selectFrom("unread_alerts")
          .selectAll()
          .execute();
        expect(alerts).toEqual([]);
      } finally {
        await test.destroy();
      }
    });

    it("refuses a conversation on another tenant's channel account", async () => {
      const test = await createTestDb();
      try {
        await conversationFixture(test);
        await test.db
          .insertInto("tenants")
          .values({ id: "tn-2", slug: "two", name: "Two" })
          .execute();

        await expect(
          test.db
            .insertInto("conversations")
            .values({
              tenant_id: "tn-2",
              channel_account_id: "ch-1",
              phone_number: "+51900000001",
            })
            .execute(),
        ).rejects.toThrow();
      } finally {
        await test.destroy();
      }
    });
  });
});

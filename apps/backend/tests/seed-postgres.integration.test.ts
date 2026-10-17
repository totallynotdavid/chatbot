import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import process from "node:process";
import { sql } from "kysely";
import { seedDatabase } from "../src/db/seed.ts";
import { BUNDLES_SEED } from "../src/db/seed-data/bundles.ts";
import { FNB_BUNDLES_SEED } from "../src/db/seed-data/fnb-bundles.ts";
import { BASE_PRODUCTS } from "../src/db/seed-data/products.ts";
import {
  createTestDb,
  postgresAvailable,
  type TestDb,
} from "./helpers/postgres.ts";

const ENV_KEYS = [
  "NODE_ENV",
  "SECRETS_KEY",
  "WHATSAPP_PHONE_ID",
  "WHATSAPP_TOKEN",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
] as const;

describe.skipIf(!postgresAvailable)("seeding Postgres", () => {
  let database: TestDb;
  let saved: Array<[string, string | undefined]>;

  beforeEach(async () => {
    saved = ENV_KEYS.map((key) => [key, process.env[key]]);
    for (const key of ENV_KEYS) {
      if (key !== "NODE_ENV") delete process.env[key];
    }
    database = await createTestDb();
  });

  afterEach(async () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await database.destroy();
  });

  async function counts() {
    const { rows } = await sql<Record<string, number>>`
      select
        (select count(*) from tenants)::int as tenants,
        (select count(*) from channel_accounts)::int as channel_accounts,
        (select count(*) from catalog_periods)::int as periods,
        (select count(*) from products)::int as products,
        (select count(*) from catalog_bundles)::int as bundles,
        (select count(*) from conversations)::int as conversations,
        (select count(*) from messages)::int as messages
    `.execute(database.db);
    return rows[0]!;
  }

  it("writes the default tenant, its catalog and two sample conversations", async () => {
    await seedDatabase(database.db);

    expect(await counts()).toEqual({
      tenants: 1,
      channel_accounts: 1,
      periods: 1,
      products: BASE_PRODUCTS.length,
      bundles: BUNDLES_SEED.length + FNB_BUNDLES_SEED.length,
      conversations: 2,
      messages: 12,
    });

    const tenant = await database.db
      .selectFrom("tenants")
      .select(["id", "slug"])
      .executeTakeFirstOrThrow();
    expect(tenant.slug).toBe("totem");

    const account = await database.db
      .selectFrom("channel_accounts")
      .select(["phone_number_id", "status"])
      .executeTakeFirstOrThrow();
    expect(account).toEqual({
      phone_number_id: `unconfigured:${tenant.id}`,
      status: "pending",
    });

    const period = await database.db
      .selectFrom("catalog_periods")
      .select("status")
      .executeTakeFirstOrThrow();
    expect(period.status).toBe("active");
  });

  it("names, in every bundle, products that exist", async () => {
    await seedDatabase(database.db);

    const products = new Set(
      (await database.db.selectFrom("products").select("id").execute()).map(
        (row) => row.id,
      ),
    );
    const bundles = await database.db
      .selectFrom("catalog_bundles")
      .select("composition_json")
      .execute();

    const named = bundles.flatMap(({ composition_json }) => [
      ...composition_json.fixed.map((product) => product.id),
      ...composition_json.choices.flatMap((choice) =>
        choice.options.map((product) => product.id),
      ),
    ]);

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((id) => !products.has(id))).toEqual([]);
  });

  it("derives each sample conversation's state from its context", async () => {
    await seedDatabase(database.db);

    const states = await database.db
      .selectFrom("conversations")
      .select(["phone_number", "current_state"])
      .orderBy("phone_number")
      .execute();
    expect(states).toEqual([
      { phone_number: "+51999888777", current_state: "offering_products" },
      { phone_number: "+51999888888", current_state: "closing" },
    ]);
  });

  it("changes nothing when it runs again", async () => {
    await seedDatabase(database.db);
    const first = await counts();

    await seedDatabase(database.db);

    expect(await counts()).toEqual(first);
  });

  it("writes no sample conversation in production", async () => {
    process.env.NODE_ENV = "production";

    await seedDatabase(database.db);

    const seeded = await counts();
    expect(seeded.conversations).toBe(0);
    expect(seeded.messages).toBe(0);
    expect(seeded.products).toBe(BASE_PRODUCTS.length);
  });

  describe("the WhatsApp number from the environment", () => {
    it("imports the credentials encrypted and activates the number", async () => {
      process.env.SECRETS_KEY = "c3".repeat(32);
      process.env.WHATSAPP_PHONE_ID = "pn-seeded";
      process.env.WHATSAPP_TOKEN = "EAAB-access-token";
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify-token";

      await seedDatabase(database.db);

      const account = await database.db
        .selectFrom("channel_accounts")
        .select([
          "phone_number_id",
          "status",
          "access_token_secret_id",
          "verify_token_secret_id",
        ])
        .executeTakeFirstOrThrow();
      expect(account).toMatchObject({
        phone_number_id: "pn-seeded",
        status: "active",
      });
      expect(account.access_token_secret_id).not.toBeNull();
      expect(account.verify_token_secret_id).not.toBeNull();

      const secrets = await database.db
        .selectFrom("channel_secrets")
        .select(["purpose", "ciphertext"])
        .execute();
      expect(secrets.map((secret) => secret.purpose).sort()).toEqual([
        "access_token",
        "verify_token",
      ]);
      expect(secrets.some((secret) => secret.ciphertext.includes("EAAB"))).toBe(
        false,
      );
    });

    it("adds the token to a number seeded without one, once a key is set", async () => {
      process.env.WHATSAPP_PHONE_ID = "pn-seeded";
      process.env.WHATSAPP_TOKEN = "EAAB-access-token";
      await seedDatabase(database.db);

      const before = await database.db
        .selectFrom("channel_accounts")
        .select("status")
        .executeTakeFirstOrThrow();
      expect(before.status).toBe("pending");

      process.env.SECRETS_KEY = "c3".repeat(32);
      await seedDatabase(database.db);

      const after = await database.db
        .selectFrom("channel_accounts")
        .select(["status", "access_token_secret_id"])
        .executeTakeFirstOrThrow();
      expect(after.status).toBe("active");
      expect(after.access_token_secret_id).not.toBeNull();
    });

    it("leaves a number that belongs to another tenant alone", async () => {
      await database.db
        .insertInto("tenants")
        .values({ id: "tn-other", slug: "other", name: "Other" })
        .execute();
      await database.db
        .insertInto("channel_accounts")
        .values({
          id: "ch-other",
          tenant_id: "tn-other",
          phone_number_id: "pn-taken",
          label: "Other",
        })
        .execute();
      process.env.WHATSAPP_PHONE_ID = "pn-taken";

      await seedDatabase(database.db);

      const totem = await database.db
        .selectFrom("channel_accounts")
        .innerJoin("tenants", "tenants.id", "channel_accounts.tenant_id")
        .select("channel_accounts.phone_number_id")
        .where("tenants.slug", "=", "totem")
        .executeTakeFirstOrThrow();
      expect(totem.phone_number_id).toStartWith("unconfigured:");

      const other = await database.db
        .selectFrom("channel_accounts")
        .select("tenant_id")
        .where("phone_number_id", "=", "pn-taken")
        .execute();
      expect(other).toEqual([{ tenant_id: "tn-other" }]);
    });
  });
});

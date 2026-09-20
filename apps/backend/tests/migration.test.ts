/**
 * Migrating a real single-business database. The one existing business must
 * keep its conversations, messages, orders, catalog and users, now addressed by
 * (tenant, channel account, phone number). The test builds a pre-tenancy
 * database, migrates it and checks each row survived with its tenant stamped on.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import process from "node:process";
import { db as appDb } from "../src/db/index.ts";
import { initializeDatabase } from "../src/db/init.ts";
import {
  backfillSessionTenants,
  needsTenantMigration,
  resolveLegacyUpload,
} from "../src/db/migrations.ts";
import { seedDatabase } from "../src/db/seed.ts";
import {
  ensureChannelAccountFromEnv,
  seedTenants,
} from "../src/db/seeds/tenants.ts";
import { accountsOn } from "../src/domains/accounts/index.ts";
import { channelAccountsOn } from "../src/domains/channels/accounts.ts";
import { PRIVATE_DIR } from "../src/lib/storage-paths.ts";
import { membershipsOn, tenantsOn } from "../src/domains/tenants/index.ts";
import type { ChannelAccount, Tenant } from "@totem/types";
import { setAccountEnv } from "./helpers/account-env.ts";
import { createTestDatabase } from "./helpers/database.ts";
import { LEGACY_SCHEMA } from "./helpers/legacy-schema.ts";

const CUSTOMER = "51999888777";

/** Session expiry far enough out that nothing under test is expiring. */
const FUTURE_EXPIRY = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;

/** A lookup the test needs to have found something, narrowed for the assertions. */
function found<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected to find ${what}`);
  }
  return value;
}

function seedLegacyData(db: Database) {
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, name, phone_number)
     VALUES ('admin-001', 'admin', 'hash', 'admin', 'Administrador', NULL),
            ('agent-001', 'agent1', 'hash', 'sales_agent', 'María', '+51914509251')`,
  ).run();

  // Two people logged in at the moment the deployment happens. Pre-tenancy
  // sessions have no tenant column at all.
  db.prepare(
    `INSERT INTO session (id, user_id, expires_at)
     VALUES ('sess-admin', 'admin-001', ?), ('sess-agent', 'agent-001', ?)`,
  ).run(FUTURE_EXPIRY, FUTURE_EXPIRY);

  db.prepare(
    `INSERT INTO catalog_periods (id, name, year_month, status)
     VALUES ('period-2026-09', 'Septiembre 2026', '2026-09', 'active')`,
  ).run();

  db.prepare(
    `INSERT INTO products (id, name, category, brand)
     VALUES ('prod-1', 'Samsung A54', 'celulares', 'samsung')`,
  ).run();

  db.prepare(
    `INSERT INTO catalog_bundles
       (id, period_id, segment, name, price, primary_category, image_id, composition_json, installments_json)
     VALUES ('bundle-1', 'period-2026-09', 'gaso', 'Combo Cocina', 1200, 'cocinas', 'img1', '{}', '[]')`,
  ).run();

  db.prepare(
    `INSERT INTO conversations
       (phone_number, client_name, dni, segment, credit_line, status, assigned_agent, context_data,
        recording_contract_path, recording_audio_path)
     VALUES (?, 'Juan Pérez', '12345678', 'fnb', 5000, 'active', 'agent-001', ?, ?, ?)`,
  ).run(
    CUSTOMER,
    JSON.stringify({
      phase: { phase: "offering_products" },
      metadata: { createdAt: 1, lastActivityAt: 2 },
    }),
    `contracts/${CUSTOMER}/contract.pdf`,
    `contracts/${CUSTOMER}/audio.mp3`,
  );

  db.prepare(
    `INSERT INTO messages (id, phone_number, direction, type, content, whatsapp_message_id)
     VALUES ('m1', ?, 'inbound', 'text', 'Hola', 'wamid.1'),
            ('m2', ?, 'outbound', 'text', '¡Qué tal!', 'wamid.2')`,
  ).run(CUSTOMER, CUSTOMER);

  db.prepare(
    `INSERT INTO message_inbox (phone_number, message_text, message_id, whatsapp_timestamp)
     VALUES (?, 'pendiente', 'wamid.3', 1700000000000)`,
  ).run(CUSTOMER);

  db.prepare(
    `INSERT INTO held_messages (phone_number, message_text, message_id, whatsapp_timestamp)
     VALUES (?, 'retenido', 'wamid.4', 1700000000000)`,
  ).run(CUSTOMER);

  db.prepare(
    `INSERT INTO orders
       (id, order_number, conversation_phone, client_name, client_dni, products, total_amount, delivery_address, assigned_agent)
     VALUES ('o1', 'ORD-20260901-001', ?, 'Juan Pérez', '12345678', '[]', 1200, 'Lima', 'agent-001')`,
  ).run(CUSTOMER);

  db.prepare(
    `INSERT INTO analytics_events (id, phone_number, event_type)
     VALUES ('a1', ?, 'session_start')`,
  ).run(CUSTOMER);

  db.prepare(
    `INSERT INTO llm_calls (id, phone_number, operation, model, prompt, user_message, status)
     VALUES ('l1', ?, 'isQuestion', 'gpt', '', '', 'success')`,
  ).run(CUSTOMER);

  db.prepare(
    `INSERT INTO audit_log (id, user_id, action, resource_type)
     VALUES ('au1', 'admin-001', 'login', 'user')`,
  ).run();

  db.prepare(
    `INSERT INTO system_settings (key, value) VALUES ('maintenance_mode', 'false')`,
  ).run();
}

describe("legacy database migration", () => {
  let dir: string;
  let db: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-migration-"));
    db = createTestDatabase(join(dir, "legacy.sqlite"));
    db.run(LEGACY_SCHEMA);
    seedLegacyData(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("recognises a pre-tenancy database", () => {
    expect(needsTenantMigration(db)).toBe(true);
  });

  it("does not re-run on a database that is already migrated", () => {
    initializeDatabase(db);
    expect(needsTenantMigration(db)).toBe(false);

    // Running again is a plain schema pass, and changes nothing.
    initializeDatabase(db);
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM tenants").get() as { c: number })
        .c,
    ).toBe(1);
  });

  it("converts a text activity timestamp it copies across to milliseconds", () => {
    const iso = "2026-03-10T15:00:00.123Z";
    db.prepare("UPDATE conversations SET last_activity_at = ?").run(iso);

    initializeDatabase(db);

    expect(
      (
        db
          .prepare(
            "SELECT last_activity_at FROM conversations WHERE phone_number = ?",
          )
          .get(CUSTOMER) as { last_activity_at: unknown }
      ).last_activity_at,
    ).toBe(Date.parse(iso));
  });

  it("does not touch a fresh database", () => {
    const fresh = createTestDatabase(join(dir, "fresh.sqlite"));
    expect(needsTenantMigration(fresh)).toBe(false);
    initializeDatabase(fresh);
    expect(
      (
        fresh.prepare("SELECT COUNT(*) as c FROM tenants").get() as {
          c: number;
        }
      ).c,
    ).toBe(0);
    fresh.close();
  });

  describe("after migrating", () => {
    let tenantId: string;
    let channelAccountId: string;

    beforeEach(() => {
      initializeDatabase(db);
      const tenant = db.prepare("SELECT id, slug FROM tenants").get() as {
        id: string;
        slug: string;
      };
      tenantId = tenant.id;
      channelAccountId = (
        db.prepare("SELECT id FROM channel_accounts").get() as { id: string }
      ).id;
    });

    it("creates one tenant with one channel account", () => {
      const tenant = db.prepare("SELECT * FROM tenants").get() as {
        slug: string;
        status: string;
      };
      expect(tenant.slug).toBe("totem");
      expect(tenant.status).toBe("active");

      const account = db.prepare("SELECT * FROM channel_accounts").get() as {
        tenant_id: string;
        channel_type: string;
      };
      expect(account.tenant_id).toBe(tenantId);
      expect(account.channel_type).toBe("whatsapp");
    });

    it("keeps the conversation, now keyed by tenant and channel account", () => {
      const conv = db
        .prepare("SELECT * FROM conversations WHERE phone_number = ?")
        .get(CUSTOMER) as Record<string, unknown>;

      expect(conv.tenant_id).toBe(tenantId);
      expect(conv.channel_account_id).toBe(channelAccountId);
      expect(conv.client_name).toBe("Juan Pérez");
      expect(conv.dni).toBe("12345678");
      expect(conv.credit_line).toBe(5000);
      expect(conv.assigned_agent).toBe("agent-001");
      // The generated column still derives from context_data.
      expect(conv.current_state).toBe("offering_products");
    });

    it("gives the audit row the actor of the user it named", () => {
      const row = db
        .prepare("SELECT user_id, actor FROM audit_log WHERE id = 'au1'")
        .get();

      expect(row).toEqual({ user_id: "admin-001", actor: "user:admin-001" });
    });

    it("keeps every child row, stamped with the tenant", () => {
      const counts = Object.fromEntries(
        [
          "messages",
          "message_inbox",
          "held_messages",
          "orders",
          "analytics_events",
          "llm_calls",
          "audit_log",
          "products",
          "catalog_bundles",
          "catalog_periods",
          "users",
        ].map((table) => [
          table,
          (
            db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as {
              c: number;
            }
          ).c,
        ]),
      );

      expect(counts).toEqual({
        messages: 2,
        message_inbox: 1,
        held_messages: 1,
        orders: 1,
        analytics_events: 1,
        llm_calls: 1,
        audit_log: 1,
        products: 1,
        catalog_bundles: 1,
        catalog_periods: 1,
        users: 2,
      });

      for (const table of [
        "messages",
        "message_inbox",
        "held_messages",
        "orders",
        "analytics_events",
        "llm_calls",
        "products",
        "catalog_bundles",
        "catalog_periods",
      ]) {
        const stray = (
          db
            .prepare(
              `SELECT COUNT(*) as c FROM ${table} WHERE tenant_id IS NOT ?`,
            )
            .get(tenantId) as { c: number }
        ).c;
        expect(`${table}:${stray}`).toBe(`${table}:0`);
      }

      const message = db
        .prepare("SELECT * FROM messages WHERE id = 'm1'")
        .get() as Record<string, unknown>;
      expect(message.channel_account_id).toBe(channelAccountId);
      expect(message.content).toBe("Hola");
      expect(message.whatsapp_message_id).toBe("wamid.1");

      const order = db
        .prepare("SELECT * FROM orders WHERE id = 'o1'")
        .get() as Record<string, unknown>;
      expect(order.channel_account_id).toBe(channelAccountId);
      expect(order.conversation_phone).toBe(CUSTOMER);
      expect(order.order_number).toBe("ORD-20260901-001");
    });

    it("makes every existing user a member of that tenant, keeping their role", () => {
      const memberships = db
        .prepare(
          "SELECT user_id, role, tenant_id FROM tenant_memberships ORDER BY user_id",
        )
        .all() as Array<{ user_id: string; role: string; tenant_id: string }>;

      expect(memberships).toEqual([
        { user_id: "admin-001", role: "admin", tenant_id: tenantId },
        { user_id: "agent-001", role: "sales_agent", tenant_id: tenantId },
      ]);
    });

    it("promotes nobody to platform operator", () => {
      expect(
        db
          .prepare("SELECT username FROM users WHERE is_platform_operator = 1")
          .all(),
      ).toEqual([]);
    });

    it("leaves the admin an ordinary member of their business, session pinned", () => {
      expect(membershipsOn(db).get(tenantId, "admin-001")?.role).toBe("admin");
      expect(
        db
          .prepare(
            "SELECT active_tenant_id FROM session WHERE id = 'sess-admin'",
          )
          .get(),
      ).toEqual({ active_tenant_id: tenantId });
    });

    it("turns uploaded contracts into private assets on the conversation", () => {
      const conv = db
        .prepare(
          "SELECT recording_contract_asset_id, recording_audio_asset_id FROM conversations WHERE phone_number = ?",
        )
        .get(CUSTOMER) as {
        recording_contract_asset_id: string | null;
        recording_audio_asset_id: string | null;
      };

      expect(conv.recording_contract_asset_id).not.toBeNull();
      expect(conv.recording_audio_asset_id).not.toBeNull();

      const assets = db
        .prepare("SELECT * FROM assets ORDER BY kind")
        .all() as Array<{
        tenant_id: string;
        kind: string;
        visibility: string;
        storage_key: string;
      }>;

      expect(assets).toHaveLength(2);
      expect(assets.map((a) => a.kind)).toEqual(["contract", "recording"]);
      expect(assets.every((a) => a.visibility === "private")).toBe(true);
      expect(assets.every((a) => a.tenant_id === tenantId)).toBe(true);
      expect(assets[0]!.storage_key).toContain(`${tenantId}/legacy/contracts/`);
    });

    // Migrated sessions must be scoped to a tenant so they pass requireTenantScope.
    it("pins carried-over sessions to the tenant their user belongs to", () => {
      const sessions = db
        .prepare(
          "SELECT id, user_id, active_tenant_id FROM session ORDER BY id",
        )
        .all() as Array<{
        id: string;
        user_id: string;
        active_tenant_id: string | null;
      }>;

      expect(sessions).toEqual([
        { id: "sess-admin", user_id: "admin-001", active_tenant_id: tenantId },
        { id: "sess-agent", user_id: "agent-001", active_tenant_id: tenantId },
      ]);
    });

    it("keeps those sessions valid, with their expiry untouched", () => {
      const expiries = db
        .prepare("SELECT expires_at FROM session")
        .all() as Array<{ expires_at: number }>;

      expect(expiries).toEqual([
        { expires_at: FUTURE_EXPIRY },
        { expires_at: FUTURE_EXPIRY },
      ]);
    });

    it("leaves platform settings alone and drops the legacy tables", () => {
      expect(
        db
          .prepare(
            "SELECT value FROM system_settings WHERE key = 'maintenance_mode'",
          )
          .get(),
      ).toEqual({ value: "false" });

      const leftovers = db
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_legacy'")
        .all();
      expect(leftovers).toEqual([]);
    });
  });
});

// Migrating a database must seed channel accounts through the same path as
// fresh databases, so credentials are imported and encrypted correctly.
describe("migrating a database with WhatsApp credentials configured", () => {
  const ENV_KEYS = [
    "SECRETS_KEY",
    "WHATSAPP_PHONE_ID",
    "WHATSAPP_TOKEN",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  ] as const;

  const PHONE_NUMBER_ID = "123456789012345";
  const ACCESS_TOKEN = "EAAG-migration-access-token";
  const VERIFY_TOKEN = "migration-verify-token";

  const saved: Record<string, string | undefined> = {};
  let dir: string;
  let db: Database;

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];

    process.env.SECRETS_KEY = "a1".repeat(32);
    process.env.WHATSAPP_PHONE_ID = PHONE_NUMBER_ID;
    process.env.WHATSAPP_TOKEN = ACCESS_TOKEN;
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;

    dir = mkdtempSync(join(tmpdir(), "totem-migration-creds-"));
    db = createTestDatabase(join(dir, "legacy.sqlite"));
    db.run(LEGACY_SCHEMA);
    seedLegacyData(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });

    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("leaves the business a channel account it can send from", () => {
    initializeDatabase(db);

    const channelAccounts = channelAccountsOn(db);
    const account = found(
      channelAccounts.getByPhoneNumberId(PHONE_NUMBER_ID),
      "the migrated channel account",
    );

    expect(account.status).toBe("active");
    expect(account.access_token_secret_id).not.toBeNull();
    expect(channelAccounts.getAccessToken(account)).toBe(ACCESS_TOKEN);
    expect(channelAccounts.getVerifyToken(account)).toBe(VERIFY_TOKEN);
  });

  it("stores the credentials encrypted, not in the account row", () => {
    initializeDatabase(db);

    const secrets = db
      .prepare("SELECT purpose, ciphertext FROM channel_secrets")
      .all() as Array<{ purpose: string; ciphertext: string }>;

    expect(secrets.map((s) => s.purpose).sort()).toEqual([
      "access_token",
      "verify_token",
    ]);
    expect(secrets.every((s) => !s.ciphertext.includes(ACCESS_TOKEN))).toBe(
      true,
    );
  });

  it("stamps the migrated rows with that same channel account", () => {
    initializeDatabase(db);

    const accountId = found(
      channelAccountsOn(db).getByPhoneNumberId(PHONE_NUMBER_ID),
      "the migrated channel account",
    ).id;

    const conversation = db
      .prepare(
        "SELECT channel_account_id FROM conversations WHERE phone_number = ?",
      )
      .get(CUSTOMER) as { channel_account_id: string };

    expect(conversation.channel_account_id).toBe(accountId);
  });

  it("falls back to a pending account when no key is configured", () => {
    delete process.env.SECRETS_KEY;

    initializeDatabase(db);

    const account = found(
      channelAccountsOn(db).getByPhoneNumberId(PHONE_NUMBER_ID),
      "the migrated channel account",
    );

    // Nothing to encrypt the token with, so it is not stored and the number is
    // marked as one that cannot yet send.
    expect(account.status).toBe("pending");
    expect(account.access_token_secret_id).toBeNull();
  });

  it("carries a user's availability onto their membership", () => {
    db.prepare(
      "UPDATE users SET is_available = 0 WHERE id = 'agent-001'",
    ).run();

    initializeDatabase(db);

    const memberships = db
      .prepare(
        "SELECT user_id, is_available FROM tenant_memberships ORDER BY user_id",
      )
      .all() as Array<{ user_id: string; is_available: number }>;

    expect(memberships).toEqual([
      { user_id: "admin-001", is_available: 1 },
      { user_id: "agent-001", is_available: 0 },
    ]);
  });
});

/**
 * The seeds write to the database they are handed. The migration relies on that
 * to run them against a database other than the process-wide one. These tests
 * seed a temporary file and check nothing landed in the application connection.
 */
describe("seeding a database the seed was handed", () => {
  let restoreEnv: () => void;
  let dir: string;
  let db: Database;

  beforeEach(() => {
    restoreEnv = setAccountEnv();

    dir = mkdtempSync(join(tmpdir(), "totem-seed-"));
    db = createTestDatabase(join(dir, "fresh.sqlite"));
    initializeDatabase(db);

    // The assertions read the application connection, so it needs a schema too.
    initializeDatabase(appDb);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  });

  it("writes the tenant, its channel account and the catalog there", async () => {
    await seedDatabase(db);

    const tenant = found(tenantsOn(db).getBySlug("totem"), "the seeded tenant");

    expect(channelAccountsOn(db).getDefaultForTenant(tenant.id)).not.toBeNull();
    expect(
      db
        .prepare("SELECT COUNT(*) as c FROM products WHERE tenant_id = ?")
        .get(tenant.id),
    ).not.toEqual({ c: 0 });
  });

  it("leaves the application connection alone", async () => {
    await seedDatabase(db);

    // By id, not slug: the application database may hold a seeded tenant of its own.
    const tenant = found(tenantsOn(db).getBySlug("totem"), "the seeded tenant");

    expect(tenantsOn(appDb).getById(tenant.id)).toBeNull();
  });

  it("creates no account, whatever the environment holds", async () => {
    await seedDatabase(db);

    expect(db.prepare("SELECT COUNT(*) as c FROM users").get()).toEqual({
      c: 0,
    });
    expect(
      db.prepare("SELECT COUNT(*) as c FROM tenant_memberships").get(),
    ).toEqual({ c: 0 });
  });
});

// Re-seeding must check whether an existing pending account can now be activated.
describe("re-seeding a channel account that was left pending", () => {
  const ENV_KEYS = [
    "SECRETS_KEY",
    "WHATSAPP_PHONE_ID",
    "WHATSAPP_TOKEN",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  ] as const;

  const KEY = "a1".repeat(32);
  const PHONE_NUMBER_ID = "222333444555666";
  const ACCESS_TOKEN = "EAAG-reseed-access-token";
  const VERIFY_TOKEN = "reseed-verify-token";

  const saved: Record<string, string | undefined> = {};
  let dir: string;
  let db: Database;

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];

    delete process.env.SECRETS_KEY;
    process.env.WHATSAPP_PHONE_ID = PHONE_NUMBER_ID;
    process.env.WHATSAPP_TOKEN = ACCESS_TOKEN;
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;

    dir = mkdtempSync(join(tmpdir(), "totem-reseed-"));
    db = createTestDatabase(join(dir, "fresh.sqlite"));
    initializeDatabase(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });

    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("imports the credentials once the key is configured", () => {
    const pending = seedTenants(db).channelAccount;
    expect(pending.status).toBe("pending");
    expect(pending.access_token_secret_id).toBeNull();

    process.env.SECRETS_KEY = KEY;
    const recovered = seedTenants(db).channelAccount;

    // The same account, now able to send.
    expect(recovered.id).toBe(pending.id);
    expect(recovered.status).toBe("active");

    const channelAccounts = channelAccountsOn(db);
    expect(channelAccounts.getAccessToken(recovered)).toBe(ACCESS_TOKEN);
    expect(channelAccounts.getVerifyToken(recovered)).toBe(VERIFY_TOKEN);
  });

  it("leaves a token that was rotated after the seed alone", () => {
    process.env.SECRETS_KEY = KEY;
    const account = seedTenants(db).channelAccount;

    const channelAccounts = channelAccountsOn(db);
    channelAccounts.setAccessToken(account.id, "EAAG-rotated-by-hand");

    // The env variables are the initial import, not the source of truth.
    const reseeded = seedTenants(db).channelAccount;
    expect(channelAccounts.getAccessToken(reseeded)).toBe(
      "EAAG-rotated-by-hand",
    );
  });

  it("does not bring a number somebody disabled back", () => {
    const pending = seedTenants(db).channelAccount;

    const channelAccounts = channelAccountsOn(db);
    channelAccounts.updateStatus(pending.id, "disabled");

    process.env.SECRETS_KEY = KEY;
    const reseeded = seedTenants(db).channelAccount;

    // The credentials are imported, but the number stays disabled.
    expect(reseeded.status).toBe("disabled");
    expect(channelAccounts.getAccessToken(reseeded)).toBe(ACCESS_TOKEN);
  });

  describe("when the configured number belongs to another tenant", () => {
    let theirs: ChannelAccount;
    let seeded: { tenant: Tenant; channelAccount: ChannelAccount };

    beforeEach(() => {
      process.env.SECRETS_KEY = KEY;
      // As the application connection has it, so a row pairing one tenant with
      // another tenant's number is refused rather than written.
      db.run("PRAGMA foreign_keys = ON;");

      const other = tenantsOn(db).create({
        slug: "otra-empresa",
        name: "Otra",
      });
      theirs = channelAccountsOn(db).create({
        tenantId: other.id,
        phoneNumberId: PHONE_NUMBER_ID,
        label: "Su número",
      });

      seeded = seedTenants(db);
    });

    it("does not hand the seeded tenant that number", () => {
      expect(seeded.channelAccount.id).not.toBe(theirs.id);
      expect(seeded.channelAccount.tenant_id).toBe(seeded.tenant.id);
    });

    it("leaves the seeded tenant a pending number with no credentials", () => {
      expect(seeded.channelAccount.status).toBe("pending");
      expect(
        channelAccountsOn(db).getAccessToken(seeded.channelAccount),
      ).toBeNull();
    });

    it("does not write credentials into the other tenant's number", () => {
      const untouched = found(
        channelAccountsOn(db).getById(theirs.id),
        "the other tenant's account",
      );
      expect(untouched.status).toBe("pending");
      expect(channelAccountsOn(db).getAccessToken(untouched)).toBeNull();
    });

    it("gives the seeded tenant the same number on every seed", () => {
      expect(seedTenants(db).channelAccount.id).toBe(seeded.channelAccount.id);
    });

    it("lets the whole seed run on it", async () => {
      await seedDatabase(db);
    });
  });
});

describe("seeding channel accounts with no WhatsApp number configured", () => {
  let savedPhoneId: string | undefined;
  let dir: string;
  let db: Database;

  beforeEach(() => {
    savedPhoneId = process.env.WHATSAPP_PHONE_ID;
    delete process.env.WHATSAPP_PHONE_ID;

    dir = mkdtempSync(join(tmpdir(), "totem-unconfigured-"));
    db = createTestDatabase(join(dir, "fresh.sqlite"));
    initializeDatabase(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });

    if (savedPhoneId === undefined) delete process.env.WHATSAPP_PHONE_ID;
    else process.env.WHATSAPP_PHONE_ID = savedPhoneId;
  });

  it("gives each tenant a pending number of its own", () => {
    const tenants = tenantsOn(db);
    const first = tenants.create({ slug: "primera", name: "Primera" });
    const second = tenants.create({ slug: "segunda", name: "Segunda" });

    const firstAccount = ensureChannelAccountFromEnv(db, first.id);
    const secondAccount = ensureChannelAccountFromEnv(db, second.id);

    expect(secondAccount.id).not.toBe(firstAccount.id);
    expect(firstAccount.tenant_id).toBe(first.id);
    expect(secondAccount.tenant_id).toBe(second.id);
    expect(firstAccount.status).toBe("pending");
    expect(secondAccount.status).toBe("pending");
  });

  it("finds that same number again on the next seed", () => {
    const tenant = tenantsOn(db).create({ slug: "unica", name: "Única" });

    const seeded = ensureChannelAccountFromEnv(db, tenant.id);

    expect(ensureChannelAccountFromEnv(db, tenant.id).id).toBe(seeded.id);
    expect(channelAccountsOn(db).listForTenant(tenant.id)).toHaveLength(1);
  });
});

// Upload migration must copy files before updating the database and fail
// atomically if the copy fails, leaving the database rollback-safe.
describe("migrating uploads that exist on disk", () => {
  const UPLOAD_CUSTOMER = "51900111222";
  const CONTRACT_BYTES = "%PDF-1.4 signed contract";
  const AUDIO_BYTES = "ID3 call recording";
  /** Stands in for whatever a traversal path would have reached. */
  const SECRET_BYTES = "-----BEGIN OPENSSH PRIVATE KEY-----";

  let dir: string;
  let db: Database;
  /**
   * Legacy uploads live under `<cwd>/data`, not under UPLOAD_DIR, and the
   * migration reads them from there. It writes to a different root (PRIVATE_DIR).
   */
  let legacyRoot: string;
  let legacyDir: string;
  let privateRoots: string[];

  function legacyDatabase(contractPath: string | null, audioPath: string) {
    const database = createTestDatabase(join(dir, "legacy.sqlite"));
    database.run(LEGACY_SCHEMA);
    database
      .prepare(
        `INSERT INTO conversations
           (phone_number, client_name, context_data, recording_contract_path, recording_audio_path)
         VALUES (?, 'Juan', '{}', ?, ?)`,
      )
      .run(UPLOAD_CUSTOMER, contractPath, audioPath);
    return database;
  }

  function tenantOf(database: Database): string {
    const row = database.prepare("SELECT id FROM tenants").get() as {
      id: string;
    };
    privateRoots.push(join(PRIVATE_DIR, row.id));
    return row.id;
  }

  /** Contents of every file in a directory tree, for "these bytes are absent". */
  function filesUnder(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(join(root, entry.name))
        : [readFileSync(join(root, entry.name), "utf-8")],
    );
  }

  /** What /api/assets/:id would serve for an asset with that storage key. */
  function storedAt(storageKey: string): string | null {
    const file = join(PRIVATE_DIR, storageKey);
    return existsSync(file) ? readFileSync(file, "utf-8") : null;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-uploads-migration-"));
    legacyRoot = join(process.cwd(), "data");
    legacyDir = join(legacyRoot, "contracts", UPLOAD_CUSTOMER);
    privateRoots = [];

    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "contract.pdf"), CONTRACT_BYTES);
    writeFileSync(join(legacyDir, "audio.mp3"), AUDIO_BYTES);
  });

  afterEach(() => {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(legacyRoot, "contracts", UPLOAD_CUSTOMER), {
      recursive: true,
      force: true,
    });
    for (const root of privateRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("puts the bytes at the key the asset row names", () => {
    db = legacyDatabase(
      `contracts/${UPLOAD_CUSTOMER}/contract.pdf`,
      `contracts/${UPLOAD_CUSTOMER}/audio.mp3`,
    );

    initializeDatabase(db);
    tenantOf(db);

    const assets = db
      .prepare("SELECT id, kind, storage_key FROM assets ORDER BY kind")
      .all() as Array<{ id: string; kind: string; storage_key: string }>;

    expect(assets).toHaveLength(2);

    const contract = found(
      assets.find((a) => a.kind === "contract"),
      "the contract asset",
    );
    const recording = found(
      assets.find((a) => a.kind === "recording"),
      "the recording asset",
    );

    // The bytes must be at the path each row's storage key names.
    expect(storedAt(contract.storage_key)).toBe(CONTRACT_BYTES);
    expect(storedAt(recording.storage_key)).toBe(AUDIO_BYTES);

    // The conversation points at those same assets.
    const conv = db
      .prepare(
        `SELECT recording_contract_asset_id, recording_audio_asset_id
         FROM conversations WHERE phone_number = ?`,
      )
      .get(UPLOAD_CUSTOMER) as {
      recording_contract_asset_id: string;
      recording_audio_asset_id: string;
    };

    expect(conv.recording_contract_asset_id).toBe(contract.id);
    expect(conv.recording_audio_asset_id).toBe(recording.id);
  });

  it("removes the legacy duplicate once the migration has committed", () => {
    db = legacyDatabase(
      `contracts/${UPLOAD_CUSTOMER}/contract.pdf`,
      `contracts/${UPLOAD_CUSTOMER}/audio.mp3`,
    );

    initializeDatabase(db);
    tenantOf(db);

    expect(existsSync(join(legacyDir, "contract.pdf"))).toBe(false);
    expect(existsSync(join(legacyDir, "audio.mp3"))).toBe(false);
  });

  it("refuses a legacy path that points outside data/", () => {
    // `recording_contract_path` is unvalidated input. Sanitising the destination
    // key alone would let the source climb out of data/ on enough `../`, so the
    // migration would copy a file it must not read and /api/assets/:id would
    // serve it under an in-prefix storage key.
    const secret = join(dir, "id_rsa");
    writeFileSync(secret, SECRET_BYTES);

    db = legacyDatabase(
      relative(legacyRoot, secret),
      `contracts/${UPLOAD_CUSTOMER}/audio.mp3`,
    );

    initializeDatabase(db);
    const tenantId = tenantOf(db);

    // The file was never read. No file under the tenant's private storage holds
    // its bytes, and the original is untouched.
    expect(filesUnder(join(PRIVATE_DIR, tenantId))).not.toContain(SECRET_BYTES);
    expect(readFileSync(secret, "utf-8")).toBe(SECRET_BYTES);

    // The traversal path produces no asset, no key and no bytes. The legitimate
    // upload alongside it still migrates.
    const assets = db
      .prepare("SELECT kind, storage_key FROM assets")
      .all() as Array<{ kind: string; storage_key: string }>;

    expect(assets).toHaveLength(1);
    expect(assets[0]!.kind).toBe("recording");
    expect(assets[0]!.storage_key.startsWith(`${tenantId}/legacy/`)).toBe(true);
    expect(storedAt(assets[0]!.storage_key)).toBe(AUDIO_BYTES);

    // The conversation records the one upload that survived and nothing for
    // the one that was refused.
    const conv = db
      .prepare(
        `SELECT recording_contract_asset_id, recording_audio_asset_id
         FROM conversations WHERE phone_number = ?`,
      )
      .get(UPLOAD_CUSTOMER) as {
      recording_contract_asset_id: string | null;
      recording_audio_asset_id: string | null;
    };

    expect(conv.recording_contract_asset_id).toBeNull();
    expect(conv.recording_audio_asset_id).not.toBeNull();
  });

  describe("a legacy path inside data/ that links outside it", () => {
    let secret: string;

    beforeEach(() => {
      secret = join(dir, "outside", "id_rsa");
      mkdirSync(join(dir, "outside"));
      writeFileSync(secret, SECRET_BYTES);
    });

    /** Migrates with the contract at `contractPath` and checks it was refused. */
    function expectContractRefused(contractPath: string) {
      db = legacyDatabase(
        contractPath,
        `contracts/${UPLOAD_CUSTOMER}/audio.mp3`,
      );

      initializeDatabase(db);
      const tenantId = tenantOf(db);

      expect(filesUnder(join(PRIVATE_DIR, tenantId))).not.toContain(
        SECRET_BYTES,
      );
      expect(readFileSync(secret, "utf-8")).toBe(SECRET_BYTES);

      const assets = db
        .prepare("SELECT kind, storage_key FROM assets")
        .all() as Array<{ kind: string; storage_key: string }>;

      expect(assets.map((asset) => asset.kind)).toEqual(["recording"]);
      const recording = found(assets[0], "the recording asset");
      expect(storedAt(recording.storage_key)).toBe(AUDIO_BYTES);
    }

    it("refuses a file that is a symlink to somewhere else", () => {
      rmSync(join(legacyDir, "contract.pdf"));
      symlinkSync(secret, join(legacyDir, "contract.pdf"));

      expectContractRefused(`contracts/${UPLOAD_CUSTOMER}/contract.pdf`);
    });

    it("refuses a file under a directory that is a symlink to somewhere else", () => {
      symlinkSync(join(dir, "outside"), join(legacyDir, "linked"));

      expectContractRefused(`contracts/${UPLOAD_CUSTOMER}/linked/id_rsa`);
    });
  });

  describe("a legacy root that is itself a symlink", () => {
    let realRoot: string;
    let linkedRoot: string;

    beforeEach(() => {
      realRoot = join(dir, "volume", "data");
      linkedRoot = join(dir, "data");
      mkdirSync(join(realRoot, "contracts"), { recursive: true });
      writeFileSync(
        join(realRoot, "contracts", "contract.pdf"),
        CONTRACT_BYTES,
      );
      symlinkSync(realRoot, linkedRoot);
    });

    it("still reads the files under it", () => {
      const from = found(
        resolveLegacyUpload(linkedRoot, "contracts/contract.pdf"),
        "the contract under the linked root",
      );

      expect(readFileSync(from, "utf-8")).toBe(CONTRACT_BYTES);
    });

    it("still accepts a link that stays inside it", () => {
      symlinkSync(
        join(realRoot, "contracts", "contract.pdf"),
        join(realRoot, "contracts", "alias.pdf"),
      );

      const from = resolveLegacyUpload(linkedRoot, "contracts/alias.pdf");

      expect(from).toBe(join(realRoot, "contracts", "contract.pdf"));
    });

    it("still refuses a link that leaves it", () => {
      writeFileSync(join(dir, "id_rsa"), SECRET_BYTES);
      symlinkSync(join(dir, "id_rsa"), join(realRoot, "contracts", "key.pdf"));

      expect(resolveLegacyUpload(linkedRoot, "contracts/key.pdf")).toBeNull();
    });
  });

  describe("when a file cannot be copied", () => {
    beforeEach(() => {
      // A directory where the migration expects a file makes `existsSync`
      // report the upload and `copyFileSync` fail. This simulates a permission
      // or disk fault without needing one.
      rmSync(join(legacyDir, "contract.pdf"));
      mkdirSync(join(legacyDir, "contract.pdf"));

      db = legacyDatabase(
        `contracts/${UPLOAD_CUSTOMER}/contract.pdf`,
        `contracts/${UPLOAD_CUSTOMER}/audio.mp3`,
      );
    });

    it("aborts the migration instead of recording a file it did not write", () => {
      expect(() => initializeDatabase(db)).toThrow(/failed to copy legacy/i);
    });

    it("leaves the database exactly as it found it", () => {
      try {
        initializeDatabase(db);
      } catch {
        // The assertion is on what survived, not on the throw.
      }

      // Rolled all the way back: still a legacy database, so running the
      // migration again is the recovery rather than a hand-repair.
      expect(needsTenantMigration(db)).toBe(true);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assets'",
          )
          .get(),
      ).toBeNull();
      expect(
        db
          .prepare(
            `SELECT recording_contract_path, recording_audio_path
             FROM conversations WHERE phone_number = ?`,
          )
          .get(UPLOAD_CUSTOMER),
      ).toEqual({
        recording_contract_path: `contracts/${UPLOAD_CUSTOMER}/contract.pdf`,
        recording_audio_path: `contracts/${UPLOAD_CUSTOMER}/audio.mp3`,
      });
    });

    it("leaves every legacy file where it was", () => {
      try {
        initializeDatabase(db);
      } catch {
        // As above.
      }

      // Including the one that copied cleanly before the failure: nothing is
      // deleted until the transaction has committed.
      expect(existsSync(join(legacyDir, "contract.pdf"))).toBe(true);
      expect(readFileSync(join(legacyDir, "audio.mp3"), "utf-8")).toBe(
        AUDIO_BYTES,
      );
    });

    it("migrates cleanly once the cause is fixed", () => {
      try {
        initializeDatabase(db);
      } catch {
        // As above.
      }

      rmSync(join(legacyDir, "contract.pdf"), { recursive: true });
      writeFileSync(join(legacyDir, "contract.pdf"), CONTRACT_BYTES);

      initializeDatabase(db);
      tenantOf(db);

      expect(needsTenantMigration(db)).toBe(false);

      const assets = db
        .prepare("SELECT kind, storage_key FROM assets ORDER BY kind")
        .all() as Array<{ kind: string; storage_key: string }>;

      expect(assets).toHaveLength(2);
      expect(storedAt(assets[0]!.storage_key)).toBe(CONTRACT_BYTES);
      expect(storedAt(assets[1]!.storage_key)).toBe(AUDIO_BYTES);
    });
  });
});

/**
 * `backfillSessionTenants` restates `defaultTenantForUser` in SQL. A
 * single-business legacy database only ever produces one of its three cases, so
 * the rule is checked here against all of them.
 */
describe("the scope a carried-over session is given", () => {
  let dir: string;
  let db: Database;

  function user(id: string, isPlatformOperator = false): void {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, name, is_platform_operator)
       VALUES (?, ?, 'x', 'admin', ?, ?)`,
    ).run(id, `user-${id}`, id, isPlatformOperator ? 1 : 0);

    db.prepare(
      "INSERT INTO session (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, NULL, ?)",
    ).run(`sess-${id}`, id, FUTURE_EXPIRY);
  }

  function tenant(id: string): void {
    db.prepare("INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)").run(
      id,
      id,
      id,
    );
  }

  function member(tenantId: string, userId: string): void {
    db.prepare(
      "INSERT INTO tenant_memberships (id, tenant_id, user_id, role) VALUES (?, ?, ?, 'admin')",
    ).run(crypto.randomUUID(), tenantId, userId);
  }

  function scopeOf(userId: string): string | null {
    return (
      db
        .prepare("SELECT active_tenant_id FROM session WHERE user_id = ?")
        .get(userId) as { active_tenant_id: string | null }
    ).active_tenant_id;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-session-backfill-"));
    db = createTestDatabase(join(dir, "fresh.sqlite"));
    initializeDatabase(db);

    tenant("tn-one");
    tenant("tn-two");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("is the single tenant somebody belongs to", () => {
    user("solo");
    member("tn-one", "solo");

    backfillSessionTenants(db);

    expect(scopeOf("solo")).toBe("tn-one");
  });

  it("is nothing for somebody who belongs to several", () => {
    user("both");
    member("tn-one", "both");
    member("tn-two", "both");

    backfillSessionTenants(db);

    // Only they can say which business they meant.
    expect(scopeOf("both")).toBeNull();
  });

  it("is nothing for a platform operator", () => {
    user("staff", true);
    member("tn-one", "staff");

    backfillSessionTenants(db);

    // Their scope is chosen, never implied. Login follows the same rule.
    expect(scopeOf("staff")).toBeNull();
  });

  it("leaves a session that already names a tenant alone", () => {
    user("pinned");
    member("tn-one", "pinned");
    member("tn-two", "pinned");
    db.prepare(
      "UPDATE session SET active_tenant_id = 'tn-two' WHERE user_id = 'pinned'",
    ).run();

    backfillSessionTenants(db);

    expect(scopeOf("pinned")).toBe("tn-two");
  });
});

/**
 * Migrating promotes nobody. The environment asks for a promotion throughout,
 * to show it is not read.
 */
describe("migrating a legacy database", () => {
  let restoreEnv: () => void;
  let dir: string;
  let db: Database;

  function operators(): string[] {
    return (
      db
        .prepare(
          "SELECT username FROM users WHERE is_platform_operator = 1 ORDER BY username",
        )
        .all() as Array<{ username: string }>
    ).map((row) => row.username);
  }

  function userCount(): number {
    return (
      db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }
    ).c;
  }

  beforeEach(() => {
    restoreEnv = setAccountEnv();

    dir = mkdtempSync(join(tmpdir(), "totem-operator-"));
    db = createTestDatabase(join(dir, "legacy.sqlite"));
    db.run(LEGACY_SCHEMA);
    seedLegacyData(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  });

  it("promotes nobody, not the oldest admin and not an account the environment names", () => {
    initializeDatabase(db);

    expect(operators()).toEqual([]);
  });

  it("promotes nobody when the admin is switched off", () => {
    db.prepare("UPDATE users SET is_active = 0 WHERE id = 'admin-001'").run();

    initializeDatabase(db);

    expect(operators()).toEqual([]);
  });

  it("promotes nobody when there is no admin left", () => {
    db.prepare("DELETE FROM session").run();
    db.prepare("DELETE FROM users WHERE id = 'admin-001'").run();
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, name, created_at)
       VALUES ('sup-001', 'supervisor1', 'hash', 'supervisor', 'Ana', 1)`,
    ).run();

    initializeDatabase(db);

    expect(operators()).toEqual([]);
  });

  it("migrates a database with no accounts at all, and creates none", () => {
    db.prepare("DELETE FROM session").run();
    db.prepare("DELETE FROM users").run();

    initializeDatabase(db);

    expect(needsTenantMigration(db)).toBe(false);
    expect(userCount()).toBe(0);
  });

  it("creates no account of its own", () => {
    const before = userCount();

    initializeDatabase(db);

    expect(userCount()).toBe(before);
  });

  it("leaves the accounts there to be promoted by name afterwards", () => {
    initializeDatabase(db);

    const promoted = accountsOn(db).promote("agent1", {
      name: "operator",
      uid: 1000,
    });

    expect(promoted.ok && promoted.value.changed).toBe(true);
    expect(operators()).toEqual(["agent1"]);
  });
});

/**
 * A migrated database has users and no platform operator. The operator command
 * supplies one.
 */
describe("giving a database that already has users a platform operator", () => {
  const PASSWORD = "a-long-enough-password";
  let dir: string;
  let db: Database;
  let tenantId: string;
  let accounts: ReturnType<typeof accountsOn>;

  function operators(): string[] {
    return (
      db
        .prepare(
          "SELECT username FROM users WHERE is_platform_operator = 1 ORDER BY username",
        )
        .all() as Array<{ username: string }>
    ).map((row) => row.username);
  }

  function userCount(): number {
    return (
      db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }
    ).c;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-operator-seed-"));
    db = createTestDatabase(join(dir, "legacy.sqlite"));
    db.run(LEGACY_SCHEMA);
    seedLegacyData(db);
    initializeDatabase(db);

    tenantId = found(
      tenantsOn(db).getBySlug("totem"),
      "the migrated tenant",
    ).id;
    accounts = accountsOn(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates one beside the accounts it has", () => {
    const created = accounts.create(
      {
        username: "vendeya-staff",
        password: PASSWORD,
        platformOperator: true,
      },
      { name: "operator", uid: 1000 },
    );

    expect(created.ok).toBe(true);
    expect(operators()).toEqual(["vendeya-staff"]);
    expect(userCount()).toBe(3);

    // Platform staff belong to no tenant. They select one when they need it.
    const staff = db
      .prepare("SELECT id FROM users WHERE username = 'vendeya-staff'")
      .get() as { id: string };
    expect(membershipsOn(db).get(tenantId, staff.id)).toBeNull();
  });

  it("creates an admin of the one tenant it has", () => {
    const created = accounts.create(
      { username: "nueva", password: PASSWORD },
      { name: "operator", uid: 1000 },
    );

    expect(created.ok && created.value.tenant?.id).toBe(tenantId);
    expect(operators()).toEqual([]);
  });

  it("promotes one of the accounts it has, and keeps its membership", () => {
    const promoted = accounts.promote("admin", { name: "operator", uid: 1000 });

    expect(promoted.ok && promoted.value.changed).toBe(true);
    expect(operators()).toEqual(["admin"]);
    expect(membershipsOn(db).get(tenantId, "admin-001")?.role).toBe("admin");
  });

  it("refuses a username one of them already holds", () => {
    const created = accounts.create(
      {
        username: "admin",
        password: PASSWORD,
        platformOperator: true,
      },
      { name: "operator", uid: 1000 },
    );

    expect(!created.ok && created.error.reason).toBe("username_taken");
    expect(operators()).toEqual([]);
    expect(userCount()).toBe(2);
  });

  it("refuses to promote one that was switched off", () => {
    db.prepare("UPDATE users SET is_active = 0 WHERE id = 'admin-001'").run();

    const promoted = accounts.promote("admin", { name: "operator", uid: 1000 });

    expect(!promoted.ok && promoted.error.reason).toBe("inactive");
    expect(operators()).toEqual([]);
  });
});

/**
 * SQLite defaults `PRAGMA foreign_keys` to off, which leaves every REFERENCES
 * and ON DELETE CASCADE in schema.sql unenforced. These tests check that the
 * connection the app uses turns enforcement on.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

import { db } from "../src/db/index.ts";
import { initializeDatabase } from "../src/db/init.ts";
import {
  addChannelAccount,
  applySchema,
  createMember,
  createTenantFixture,
  dropTenantFixture,
  insertConversation,
  type TenantFixture,
} from "./helpers/tenancy.ts";
import { requireAuth } from "../src/middleware/auth.ts";
import {
  createSession,
  generateSessionToken,
} from "../src/platform/auth/session.ts";
import tenantRoutes from "../src/routes/tenants.ts";
import simulatorRoutes from "../src/routes/simulator.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import webhook from "../src/routes/webhook.ts";
import { signedWebhookRequest } from "./helpers/webhook.ts";
import type { ConversationRef } from "@totem/types";
import { createTestDatabase } from "./helpers/database.ts";

describe("foreign key enforcement", () => {
  let tenant: TenantFixture;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("fk");
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  it("is on for the application connection", () => {
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
  });

  it("rejects a membership for a user that does not exist", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
           VALUES (?, ?, 'no-such-user', 'admin')`,
        )
        .run(crypto.randomUUID(), tenant.tenantId),
    ).toThrow();
  });

  it("rejects a membership for a tenant that does not exist", () => {
    const userId = `u-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, name)
       VALUES (?, ?, 'x', 'admin', 'Test')`,
    ).run(userId, `user-${userId.slice(2, 10)}`);

    expect(() =>
      db
        .prepare(
          `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
           VALUES (?, 'no-such-tenant', ?, 'admin')`,
        )
        .run(crypto.randomUUID(), userId),
    ).toThrow();

    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  it("rejects a conversation on a channel account that does not exist", () => {
    expect(() =>
      insertConversation({
        tenantId: tenant.tenantId,
        channelAccountId: "no-such-channel",
        phoneNumber: "51900000000",
      }),
    ).toThrow();
  });

  it("rejects a message with no conversation behind it", () => {
    expect(() =>
      MessageStore.log(tenant.ref("51900000001"), "inbound", "text", "hola"),
    ).toThrow();
  });

  // Every table carrying both columns must reference the pair together, not
  // each one independently, so a mismatch is a constraint failure.
  describe("a tenant paired with another tenant's number", () => {
    let other: TenantFixture;

    beforeEach(() => {
      other = createTenantFixture("fk-other");
    });

    afterEach(() => {
      dropTenantFixture(other);
    });

    it("is refused on a conversation", () => {
      expect(() =>
        insertConversation({
          tenantId: tenant.tenantId,
          channelAccountId: other.channelAccountId,
          phoneNumber: "51900000010",
        }),
      ).toThrow();
    });

    /**
     * The tables that carry the pair without a conversation row in between, so
     * the composite key on `channel_accounts` is the only thing checking them.
     * Each builds its statement from a (tenant, channel account) pair.
     */
    const pairedTables: Array<{
      table: string;
      insert: (tenantId: string, channelAccountId: string) => void;
    }> = [
      {
        table: "message_inbox",
        insert: (tenantId, channelAccountId) =>
          db
            .prepare(
              `INSERT INTO message_inbox
                 (tenant_id, channel_account_id, phone_number, message_text, message_id, whatsapp_timestamp)
               VALUES (?, ?, '51900000011', 'hola', ?, 1)`,
            )
            .run(tenantId, channelAccountId, crypto.randomUUID()),
      },
      {
        table: "held_messages",
        insert: (tenantId, channelAccountId) =>
          db
            .prepare(
              `INSERT INTO held_messages
                 (tenant_id, channel_account_id, phone_number, message_text, message_id, whatsapp_timestamp)
               VALUES (?, ?, '51900000012', 'hola', ?, 1)`,
            )
            .run(tenantId, channelAccountId, crypto.randomUUID()),
      },
      {
        table: "analytics_events",
        insert: (tenantId, channelAccountId) =>
          db
            .prepare(
              `INSERT INTO analytics_events
                 (id, tenant_id, channel_account_id, phone_number, event_type)
               VALUES (?, ?, ?, '51900000013', 'message_received')`,
            )
            .run(crypto.randomUUID(), tenantId, channelAccountId),
      },
      {
        table: "llm_calls",
        insert: (tenantId, channelAccountId) =>
          db
            .prepare(
              `INSERT INTO llm_calls
                 (id, tenant_id, channel_account_id, phone_number, operation, model, prompt, user_message, status)
               VALUES (?, ?, ?, '51900000014', 'classify', 'gpt', 'p', 'u', 'success')`,
            )
            .run(crypto.randomUUID(), tenantId, channelAccountId),
      },
    ];

    for (const { table, insert } of pairedTables) {
      it(`is refused on ${table}`, () => {
        expect(() => insert(tenant.tenantId, other.channelAccountId)).toThrow();
      });

      it(`still accepts ${table} when the pair matches`, () => {
        expect(() =>
          insert(tenant.tenantId, tenant.channelAccountId),
        ).not.toThrow();
      });
    }

    it("is refused on a message, even with a conversation of its own", () => {
      // A conversation with this phone number exists under the other tenant.
      // The message still pairs this tenant with the other tenant's number.
      insertConversation(other.ref("51900000015"));

      expect(() =>
        db
          .prepare(
            `INSERT INTO messages
               (id, tenant_id, channel_account_id, phone_number, direction, type, content)
             VALUES (?, ?, ?, '51900000015', 'inbound', 'text', 'hola')`,
          )
          .run(crypto.randomUUID(), tenant.tenantId, other.channelAccountId),
      ).toThrow();
    });

    it("is refused on an order", () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO orders
               (id, tenant_id, channel_account_id, order_number, conversation_phone,
                client_name, client_dni, products, total_amount, delivery_address)
             VALUES (?, ?, ?, ?, '51900000016', 'Ana', '12345678', '[]', 100, 'Lima')`,
          )
          .run(
            crypto.randomUUID(),
            tenant.tenantId,
            other.channelAccountId,
            `A-${crypto.randomUUID().slice(0, 8)}`,
          ),
      ).toThrow();
    });
  });

  /**
   * The database rejects a bundle that names one tenant while its period
   * belongs to another. The route checks this too, but a check in one handler
   * is not a constraint.
   */
  describe("a bundle in another tenant's period", () => {
    let other: TenantFixture;

    beforeEach(() => {
      other = createTenantFixture("fk-period");
    });

    afterEach(() => {
      dropTenantFixture(other);
    });

    function createPeriod(tenantId: string, yearMonth: string): string {
      const id = `per-${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO catalog_periods (id, tenant_id, name, year_month)
         VALUES (?, ?, 'Septiembre', ?)`,
      ).run(id, tenantId, yearMonth);
      return id;
    }

    function insertBundle(tenantId: string, periodId: string): void {
      db.prepare(
        `INSERT INTO catalog_bundles
           (id, tenant_id, period_id, segment, name, price, primary_category,
            image_id, composition_json, installments_json)
         VALUES (?, ?, ?, 'gaso', 'Combo', 999, 'cocinas', 'img-1', '[]', '[]')`,
      ).run(`bundle-${crypto.randomUUID()}`, tenantId, periodId);
    }

    it("is refused", () => {
      const theirPeriod = createPeriod(other.tenantId, "2026-09");

      expect(() => insertBundle(tenant.tenantId, theirPeriod)).toThrow();
    });

    it("is still accepted when the period is the tenant's own", () => {
      const ownPeriod = createPeriod(tenant.tenantId, "2026-09");

      expect(() => insertBundle(tenant.tenantId, ownPeriod)).not.toThrow();
    });

    it("cascades a period delete to the bundles in it", () => {
      const period = createPeriod(tenant.tenantId, "2026-10");
      insertBundle(tenant.tenantId, period);

      db.prepare("DELETE FROM catalog_periods WHERE id = ?").run(period);

      expect(
        db
          .prepare(
            "SELECT COUNT(*) as count FROM catalog_bundles WHERE period_id = ?",
          )
          .get(period),
      ).toEqual({ count: 0 });
    });
  });

  it("cascades a tenant delete through its children", () => {
    const scratch = createTenantFixture("fk-cascade");
    const ref = scratch.ref("51900000002");
    insertConversation(ref);
    MessageStore.log(ref, "inbound", "text", "hola");

    expect(MessageStore.getHistory(ref)).toHaveLength(1);

    db.prepare("DELETE FROM tenants WHERE id = ?").run(scratch.tenantId);

    expect(
      db
        .prepare("SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ?")
        .get(scratch.tenantId),
    ).toEqual({ c: 0 });
    expect(
      db
        .prepare("SELECT COUNT(*) as c FROM messages WHERE tenant_id = ?")
        .get(scratch.tenantId),
    ).toEqual({ c: 0 });
  });

  // Every table referencing conversations must specify ON DELETE CASCADE so
  // deleting a conversation doesn't leave orphaned rows.
  describe("deleting a conversation that has an order behind it", () => {
    const CUSTOMER = "51900000020";

    function insertOrder(ref: ConversationRef): string {
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO orders
           (id, tenant_id, channel_account_id, order_number, conversation_phone,
            client_name, client_dni, products, total_amount, delivery_address)
         VALUES (?, ?, ?, ?, ?, 'Ana', '12345678', '[]', 100, 'Lima')`,
      ).run(
        id,
        ref.tenantId,
        ref.channelAccountId,
        `A-${crypto.randomUUID().slice(0, 8)}`,
        ref.phoneNumber,
      );
      return id;
    }

    function orderCount(id: string): number {
      return (
        db.prepare("SELECT COUNT(*) as c FROM orders WHERE id = ?").get(id) as {
          c: number;
        }
      ).c;
    }

    it("takes the order with it rather than failing", () => {
      const ref = tenant.ref(CUSTOMER);
      insertConversation(ref);
      const orderId = insertOrder(ref);

      expect(() =>
        db
          .prepare(
            `DELETE FROM conversations
             WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
          )
          .run(ref.tenantId, ref.channelAccountId, ref.phoneNumber),
      ).not.toThrow();

      expect(orderCount(orderId)).toBe(0);
    });

    it("lets the simulator delete a conversation that reached checkout", async () => {
      const account = ChannelAccountService.getDefaultForTenant(
        tenant.tenantId,
      )!;
      const ref = {
        tenantId: tenant.tenantId,
        channelAccountId: account.id,
        phoneNumber: CUSTOMER,
      };
      insertConversation(ref, { isSimulation: true });
      const orderId = insertOrder(ref);

      const admin = createMember(tenant, "admin");
      const token = generateSessionToken();
      createSession(token, admin.userId, tenant.tenantId);

      const app = new Hono();
      app.use("/api/*", requireAuth);
      app.route("/api/simulator", simulatorRoutes);

      const response = await app.request(
        `/api/simulator/conversations/${CUSTOMER}`,
        { method: "DELETE", headers: { Cookie: `session=${token}` } },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "deleted" });
      expect(orderCount(orderId)).toBe(0);
    });
  });

  describe("routes that used to lean on the unenforced constraint", () => {
    function buildApp() {
      const app = new Hono();
      app.use("/api/*", requireAuth);
      app.route("/api/tenants", tenantRoutes);
      return app;
    }

    it("grants no membership to a user id that does not exist", async () => {
      const operatorId = `u-${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, name, is_platform_operator)
         VALUES (?, ?, 'x', 'admin', 'Operator', 1)`,
      ).run(operatorId, `op-${operatorId.slice(2, 10)}`);

      const token = generateSessionToken();
      createSession(token, operatorId, null);

      const response = await buildApp().request(
        `/api/tenants/${tenant.tenantId}/members`,
        {
          method: "POST",
          headers: {
            Cookie: `session=${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId: "ghost-user", role: "admin" }),
        },
      );

      // A clean 404, not a constraint error and not an orphan row.
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "User not found" });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) as c FROM tenant_memberships WHERE user_id = 'ghost-user'",
          )
          .get(),
      ).toEqual({ c: 0 });

      db.prepare("DELETE FROM session WHERE user_id = ?").run(operatorId);
      db.prepare("DELETE FROM users WHERE id = ?").run(operatorId);
    });

    it("creates the conversation before logging an inbound message", async () => {
      const contact = "51900000003";
      const account = addChannelAccount(tenant);

      const response = await webhook.request(
        "/",
        signedWebhookRequest({
          entry: [
            {
              id: "waba-fk",
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: account.phoneNumberId },
                    messages: [
                      {
                        from: contact,
                        id: `wamid-${crypto.randomUUID()}`,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "hola" },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }),
      );

      expect(await response.json()).toEqual({
        results: [{ phoneNumberId: account.phoneNumberId, status: "received" }],
      });

      const ref = account.ref(contact);
      expect(
        db
          .prepare(
            `SELECT COUNT(*) as c FROM conversations
             WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
          )
          .get(ref.tenantId, ref.channelAccountId, ref.phoneNumber),
      ).toEqual({ c: 1 });
      expect(MessageStore.getHistory(ref)).toHaveLength(1);
    });
  });
});

/**
 * Every table carrying both columns has to reference the pair, not the two
 * columns separately. The tests above prove it one table at a time. This one
 * catches a new table with independent references, which would compile, pass
 * its own tests, and accept cross-tenant rows.
 */
describe("the composite reference itself", () => {
  let dir: string;
  let fresh: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-fk-shape-"));
    fresh = createTestDatabase(join(dir, "fresh.sqlite"));
    initializeDatabase(fresh);
  });

  afterEach(() => {
    fresh.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function tablesWithBothColumns(): string[] {
    const tables = fresh
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string }>;

    return tables
      .map((t) => t.name)
      .filter((name) => {
        const columns = fresh
          .prepare(`PRAGMA table_info(${name})`)
          .all() as Array<{ name: string }>;
        const has = (column: string) => columns.some((c) => c.name === column);
        return has("tenant_id") && has("channel_account_id");
      });
  }

  /**
   * The simulator's delete route removes a conversation as a whole, so every
   * table that references one must cascade the delete. A new table hung off a
   * conversation fails the expected list, and a key with any other ON DELETE
   * action fails the cascade check.
   */
  it("cascades on every table that references a conversation", () => {
    const referencing = fresh
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((t) => (t as { name: string }).name)
      .filter((name) =>
        (
          fresh.prepare(`PRAGMA foreign_key_list(${name})`).all() as Array<{
            table: string;
          }>
        ).some((key) => key.table === "conversations"),
      );

    expect(referencing.sort()).toEqual(["messages", "orders"]);

    for (const table of referencing) {
      const keys = (
        fresh.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
          table: string;
          on_delete: string;
        }>
      ).filter((key) => key.table === "conversations");

      // One row per column of the key, all carrying the same action.
      const actions = [...new Set(keys.map((key) => key.on_delete))];

      expect({ table, onDelete: actions }).toEqual({
        table,
        onDelete: ["CASCADE"],
      });
    }
  });

  it("is on every table that names a tenant and a channel account", () => {
    const tables = tablesWithBothColumns();

    // channel_accounts itself is the parent, so it is not in this set.
    expect(tables.sort()).toEqual([
      "analytics_events",
      "conversations",
      "held_messages",
      "llm_calls",
      "message_inbox",
      "messages",
      "orders",
    ]);

    for (const table of tables) {
      const keys = fresh
        .prepare(`PRAGMA foreign_key_list(${table})`)
        .all() as Array<{
        id: number;
        table: string;
        from: string;
        to: string | null;
      }>;

      // One foreign key (same `id`) covering both columns at once. Two keys
      // that each happen to point at channel_accounts would not do: it is the
      // pair being checked together that rules the mismatch out.
      const composite = keys.filter((key) => key.table === "channel_accounts");
      const ids = new Set(composite.map((key) => key.id));

      expect({ table, ids: ids.size }).toEqual({ table, ids: 1 });
      expect({
        table,
        columns: composite.map((key) => `${key.from}->${key.to}`).sort(),
      }).toEqual({
        table,
        columns: ["channel_account_id->id", "tenant_id->tenant_id"],
      });
    }
  });
});

/**
 * The migration renames tables aside while it rebuilds them, which enforcement
 * would trip. It turns foreign keys off for the rebuild and restores the prior
 * setting, including when the connection had them on as the app's does.
 */
describe("migration under an enforcing connection", () => {
  let dir: string;
  let legacy: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totem-fk-migration-"));
    legacy = createTestDatabase(join(dir, "legacy.sqlite"));
    legacy.run("PRAGMA foreign_keys = ON;");
    legacy.run(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        phone_number TEXT,
        is_active INTEGER DEFAULT 1,
        is_available INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
        created_by TEXT
      );
      CREATE TABLE conversations (
        phone_number TEXT PRIMARY KEY,
        context_data TEXT DEFAULT '{}',
        current_state TEXT GENERATED ALWAYS AS (json_extract(context_data, '$.phase.phase')) STORED,
        status TEXT DEFAULT 'active',
        is_simulation INTEGER DEFAULT 0,
        last_activity_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
        assigned_agent TEXT REFERENCES users(id)
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        phone_number TEXT NOT NULL REFERENCES conversations(phone_number) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT,
        status TEXT DEFAULT 'sent',
        created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
      );
    `);

    legacy
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, name)
         VALUES ('admin-001', 'admin', 'hash', 'admin', 'Administrador')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO conversations (phone_number, context_data, assigned_agent)
         VALUES ('51999888777', ?, 'admin-001')`,
      )
      .run(JSON.stringify({ phase: { phase: "greeting" }, metadata: {} }));
    legacy
      .prepare(
        `INSERT INTO messages (id, phone_number, direction, type, content)
         VALUES ('m1', '51999888777', 'inbound', 'text', 'Hola')`,
      )
      .run();
  });

  afterEach(() => {
    legacy.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("migrates and leaves enforcement back on, with no violations", () => {
    initializeDatabase(legacy);

    expect(legacy.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    expect(legacy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const message = legacy
      .prepare(
        "SELECT tenant_id, channel_account_id FROM messages WHERE id = 'm1'",
      )
      .get() as { tenant_id: string; channel_account_id: string };
    const tenantId = (
      legacy.prepare("SELECT id FROM tenants").get() as { id: string }
    ).id;

    expect(message.tenant_id).toBe(tenantId);
    expect(
      legacy.prepare("SELECT COUNT(*) as c FROM conversations").get(),
    ).toEqual({ c: 1 });
  });
});

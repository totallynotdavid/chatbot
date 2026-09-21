import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../../src/db/index.ts";
import { initializeDatabase } from "../../src/db/init.ts";
import type { ConversationRef } from "@totem/types";

// The fixtures write through the application's own connection, so it must be
// a throwaway database. `tests/setup.ts` points DB_PATH at a temp file before
// the connection opens. Another way of running the tests could skip that
// preload, and then nothing here may touch a developer's real database.
const dbPath = path.resolve(db.filename);

if (!dbPath.startsWith(path.resolve(tmpdir()) + path.sep)) {
  throw new Error(
    `Refusing to run tests against ${dbPath}: it is not a temporary database. ` +
      "Run them from apps/backend so bunfig.toml preloads tests/setup.ts, " +
      "or set DB_PATH to a throwaway file.",
  );
}

/**
 * Brings the test database to the current schema, migrating a legacy database
 * first. Idempotent, so every test file can call it on the shared connection.
 */
export function applySchema(): void {
  initializeDatabase(db);
}

export type TenantFixture = {
  tenantId: string;
  channelAccountId: string;
  phoneNumberId: string;
  ref(phoneNumber: string): ConversationRef;
};

/**
 * A tenant with one WhatsApp number, ready to hang conversations off. Ids are
 * random per call so test files never collide in the shared database.
 */
export function createTenantFixture(slug: string): TenantFixture {
  const tenantId = `tn-${crypto.randomUUID()}`;
  const channelAccountId = `ch-${crypto.randomUUID()}`;
  const phoneNumberId = `pnid-${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(
    "INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, ?, 'active')",
  ).run(tenantId, `${slug}-${tenantId.slice(3, 11)}`, slug);

  db.prepare(
    `INSERT INTO channel_accounts (id, tenant_id, channel_type, phone_number_id, status)
     VALUES (?, ?, 'whatsapp', ?, 'active')`,
  ).run(channelAccountId, tenantId, phoneNumberId);

  return {
    tenantId,
    channelAccountId,
    phoneNumberId,
    ref: (phoneNumber: string) => ({
      tenantId,
      channelAccountId,
      phoneNumber,
    }),
  };
}

/**
 * A second WhatsApp number for the same tenant. One contact writing to both is
 * two conversations, which is what the ambiguity guards are about.
 */
export function addChannelAccount(fixture: TenantFixture): {
  channelAccountId: string;
  phoneNumberId: string;
  ref(phoneNumber: string): ConversationRef;
} {
  const channelAccountId = `ch-${crypto.randomUUID()}`;
  const phoneNumberId = `pnid-${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(
    `INSERT INTO channel_accounts (id, tenant_id, channel_type, phone_number_id, status)
     VALUES (?, ?, 'whatsapp', ?, 'active')`,
  ).run(channelAccountId, fixture.tenantId, phoneNumberId);

  return {
    channelAccountId,
    phoneNumberId,
    ref: (phoneNumber: string) => ({
      tenantId: fixture.tenantId,
      channelAccountId,
      phoneNumber,
    }),
  };
}

/** Remove a fixture tenant and everything hanging off it. */
export function dropTenantFixture(fixture: TenantFixture | undefined): void {
  if (!fixture) return;
  const { tenantId } = fixture;
  for (const table of [
    "outbox",
    "messages",
    "message_inbox",
    "held_messages",
    "analytics_events",
    "llm_calls",
    "notification_traces",
    "orders",
    "conversations",
    "catalog_bundles",
    "catalog_periods",
    "products",
    "test_personas",
    "assets",
    "audit_log",
    "tenant_settings",
    "tenant_memberships",
    "channel_accounts",
    "channel_secrets",
  ]) {
    db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(tenantId);
  }
  db.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
}

/** Insert a conversation row directly, bypassing the handler. */
export function insertConversation(
  ref: ConversationRef,
  overrides: {
    contextData?: unknown;
    status?: string;
    clientName?: string | null;
    assignedAgent?: string | null;
    isSimulation?: boolean;
  } = {},
): void {
  db.prepare(
    `INSERT INTO conversations
       (tenant_id, channel_account_id, phone_number, context_data, status, client_name, assigned_agent, is_simulation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ref.tenantId,
    ref.channelAccountId,
    ref.phoneNumber,
    JSON.stringify(
      overrides.contextData ?? {
        phase: { phase: "greeting" },
        metadata: { createdAt: Date.now(), lastActivityAt: Date.now() },
      },
    ),
    overrides.status ?? "active",
    overrides.clientName ?? null,
    overrides.assignedAgent ?? null,
    overrides.isSimulation ? 1 : 0,
  );
}

/** A user with a membership in one tenant, plus the scope they act under. */
export function createMember(
  fixture: TenantFixture,
  role: "admin" | "developer" | "supervisor" | "sales_agent" = "admin",
) {
  const userId = `u-${crypto.randomUUID()}`;

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, name)
     VALUES (?, ?, 'x', ?, ?)`,
  ).run(userId, `user-${userId.slice(2, 10)}`, role, "Test User");

  db.prepare(
    `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
     VALUES (?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), fixture.tenantId, userId, role);

  return {
    userId,
    scope: {
      userId,
      tenantId: fixture.tenantId,
      membershipRole: role,
      isPlatformOperator: false,
    } as const,
  };
}

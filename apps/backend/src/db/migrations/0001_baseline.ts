import {
  type ColumnDefinitionBuilder,
  type Kysely,
  type RawBuilder,
  sql,
} from "kysely";

/**
 * Timestamps are epoch milliseconds in a `bigint`, the shape the API and the
 * dashboard already use, so no layer converts between a date and a number.
 * `clock_timestamp()` rather than `now()`: a transaction that inserts two rows
 * gets two readings.
 */
const NOW_MS = sql`(floor(extract(epoch from clock_timestamp()) * 1000))::bigint`;

const nowMs = (col: ColumnDefinitionBuilder) => col.notNull().defaultTo(NOW_MS);

const oneOf = (
  column: string,
  values: readonly string[],
): RawBuilder<unknown> =>
  sql`${sql.ref(column)} in (${sql.join(values.map((value) => sql.lit(value)))})`;

const ROLES = ["admin", "developer", "supervisor", "sales_agent"] as const;

// Business tables carry `tenant_id`, nullable only in `notification_traces` and
// `audit_log`, whose rows can belong to the platform. A table with both
// `tenant_id` and `channel_account_id` references `channel_accounts(id,
// tenant_id)`, so a row cannot pair a tenant with another tenant's number.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("tenants")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("slug", "text", (col) => col.notNull().unique())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) =>
      col
        .notNull()
        .defaultTo("active")
        .check(oneOf("status", ["active", "suspended"])),
    )
    .addColumn("created_at", "bigint", nowMs)
    .addColumn("updated_at", "bigint", nowMs)
    .execute();
  await db.schema
    .createIndex("idx_tenants_status")
    .on("tenants")
    .column("status")
    .execute();

  // `role` is the user's default role, copied onto a membership when one is
  // created. Authorization reads the membership role, not this column.
  // `is_platform_operator` marks VendeYa's own staff. They need no membership to
  // act in a tenant, and a promoted account keeps the memberships it already had.
  await db.schema
    .createTable("users")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("username", "text", (col) => col.notNull().unique())
    .addColumn("password_hash", "text", (col) => col.notNull())
    .addColumn("role", "text", (col) =>
      col.notNull().check(oneOf("role", ROLES)),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("phone_number", "text")
    .addColumn("is_platform_operator", "boolean", (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn("is_active", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("created_at", "bigint", nowMs)
    .addColumn("created_by", "text", (col) => col.references("users.id"))
    .execute();
  await db.schema
    .createIndex("idx_users_active")
    .on("users")
    .column("is_active")
    .execute();
  await db.schema
    .createIndex("idx_users_platform_operator")
    .on("users")
    .column("is_platform_operator")
    .execute();

  // `is_available` is the agent's own switch, and it lives here rather than on
  // the account: someone who sells for two businesses goes offline for one of
  // them without dropping out of the other's assignment rotation.
  await db.schema
    .createTable("tenant_memberships")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("role", "text", (col) =>
      col.notNull().check(oneOf("role", ROLES)),
    )
    .addColumn("is_available", "boolean", (col) =>
      col.notNull().defaultTo(true),
    )
    .addColumn("created_at", "bigint", nowMs)
    .addColumn("created_by", "text", (col) => col.references("users.id"))
    .addUniqueConstraint("tenant_memberships_tenant_user_key", [
      "tenant_id",
      "user_id",
    ])
    .execute();
  await db.schema
    .createIndex("idx_memberships_user")
    .on("tenant_memberships")
    .column("user_id")
    .execute();
  await db.schema
    .createIndex("idx_memberships_tenant_role")
    .on("tenant_memberships")
    .columns(["tenant_id", "role", "is_available"])
    .execute();

  // `active_tenant_id` is the tenant scope the session is acting in. NULL means
  // no tenant is pinned. A platform operator then gets the cross-tenant view. A
  // member has no scope until they pick a tenant.
  await db.schema
    .createTable("session")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("user_id", "text", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("active_tenant_id", "text", (col) =>
      col.references("tenants.id").onDelete("set null"),
    )
    .addColumn("expires_at", "bigint", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex("idx_session_user")
    .on("session")
    .column("user_id")
    .execute();

  // Encrypted credential store. Values are AES-256-GCM ciphertext, which cannot
  // be decrypted without the key in SECRETS_KEY.
  await db.schema
    .createTable("channel_secrets")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("purpose", "text", (col) =>
      col.notNull().check(oneOf("purpose", ["access_token", "verify_token"])),
    )
    .addColumn("ciphertext", "text", (col) => col.notNull())
    .addColumn("iv", "text", (col) => col.notNull())
    .addColumn("auth_tag", "text", (col) => col.notNull())
    .addColumn("key_id", "text", (col) => col.notNull())
    .addColumn("created_at", "bigint", nowMs)
    .addColumn("updated_at", "bigint", nowMs)
    .execute();
  await db.schema
    .createIndex("idx_channel_secrets_tenant")
    .on("channel_secrets")
    .column("tenant_id")
    .execute();

  // One row per business phone number. `channel_type` is a column rather than
  // an assumption so a second channel can be added without reshaping the table.
  // `(id, tenant_id)` is redundant with the primary key. It gives the tables
  // that carry both columns a pair to reference.
  await db.schema
    .createTable("channel_accounts")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("channel_type", "text", (col) =>
      col
        .notNull()
        .defaultTo("whatsapp")
        .check(oneOf("channel_type", ["whatsapp"])),
    )
    .addColumn("waba_id", "text")
    .addColumn("phone_number_id", "text", (col) => col.notNull())
    .addColumn("display_phone_number", "text")
    .addColumn("label", "text")
    .addColumn("access_token_secret_id", "text", (col) =>
      col.references("channel_secrets.id").onDelete("set null"),
    )
    .addColumn("verify_token_secret_id", "text", (col) =>
      col.references("channel_secrets.id").onDelete("set null"),
    )
    .addColumn("status", "text", (col) =>
      col
        .notNull()
        .defaultTo("pending")
        .check(oneOf("status", ["active", "pending", "disabled"])),
    )
    .addColumn("created_at", "bigint", nowMs)
    .addColumn("updated_at", "bigint", nowMs)
    .addUniqueConstraint("channel_accounts_number_key", [
      "channel_type",
      "phone_number_id",
    ])
    .addUniqueConstraint("channel_accounts_id_tenant_key", ["id", "tenant_id"])
    .execute();
  await db.schema
    .createIndex("idx_channel_accounts_tenant")
    .on("channel_accounts")
    .columns(["tenant_id", "status"])
    .execute();
  await db.schema
    .createIndex("idx_channel_accounts_waba")
    .on("channel_accounts")
    .column("waba_id")
    .execute();

  // `(id, tenant_id)` lets `catalog_bundles` reference the pair, so a bundle
  // cannot name one tenant while its period belongs to another.
  await db.schema
    .createTable("catalog_periods")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("year_month", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) =>
      col
        .notNull()
        .defaultTo("draft")
        .check(oneOf("status", ["draft", "active", "archived"])),
    )
    .addColumn("published_at", "bigint")
    .addColumn("created_by", "text", (col) => col.references("users.id"))
    .addColumn("created_at", "bigint", nowMs)
    .addUniqueConstraint("catalog_periods_tenant_month_key", [
      "tenant_id",
      "year_month",
    ])
    .addUniqueConstraint("catalog_periods_id_tenant_key", ["id", "tenant_id"])
    .execute();
  await db.schema
    .createIndex("idx_periods_status")
    .on("catalog_periods")
    .columns(["tenant_id", "status"])
    .execute();
  await db.schema
    .createIndex("idx_periods_year_month")
    .on("catalog_periods")
    .columns(["tenant_id", "year_month desc"])
    .execute();

  await db.schema
    .createTable("products")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("category", "text", (col) => col.notNull())
    .addColumn("brand", "text")
    .addColumn("model", "text")
    .addColumn("specs_json", "jsonb")
    .addColumn("created_at", "bigint", nowMs)
    .execute();
  await db.schema
    .createIndex("idx_products_category")
    .on("products")
    .columns(["tenant_id", "category"])
    .execute();

  await db.schema
    .createTable("catalog_bundles")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("period_id", "text", (col) => col.notNull())
    .addColumn("segment", "text", (col) =>
      col.notNull().check(oneOf("segment", ["gaso", "fnb"])),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("price", sql`numeric(12, 2)`, (col) => col.notNull())
    .addColumn("primary_category", "text", (col) => col.notNull())
    .addColumn("categories_json", "jsonb")
    .addColumn("image_id", "text", (col) => col.notNull())
    .addColumn("composition_json", "jsonb", (col) => col.notNull())
    .addColumn("installments_json", "jsonb", (col) => col.notNull())
    .addColumn("notes", "text", (col) =>
      col
        .notNull()
        .defaultTo("01 año de garantía, delivery gratuito, cero cuota inicial"),
    )
    .addColumn("is_active", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("stock_status", "text", (col) =>
      col
        .notNull()
        .defaultTo("in_stock")
        .check(
          oneOf("stock_status", ["in_stock", "low_stock", "out_of_stock"]),
        ),
    )
    .addColumn("created_by", "text", (col) => col.references("users.id"))
    .addColumn("created_at", "bigint", nowMs)
    .addColumn("updated_at", "bigint", nowMs)
    .addForeignKeyConstraint(
      "catalog_bundles_period_fkey",
      ["period_id", "tenant_id"],
      "catalog_periods",
      ["id", "tenant_id"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("idx_bundles_period")
    .on("catalog_bundles")
    .columns(["tenant_id", "period_id"])
    .execute();
  await db.schema
    .createIndex("idx_bundles_filtering")
    .on("catalog_bundles")
    .columns([
      "tenant_id",
      "period_id",
      "segment",
      "is_active",
      "stock_status",
      "primary_category",
      "price",
    ])
    .execute();

  // Identity is (tenant, channel account, contact phone number): the same person
  // writing to two businesses, or to two of one business's numbers, is two
  // separate conversations.
  await db.schema
    .createTable("conversations")
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("channel_account_id", "text", (col) => col.notNull())
    .addColumn("phone_number", "text", (col) => col.notNull())
    .addColumn("client_name", "text")
    .addColumn("dni", "text")
    .addColumn("is_calidda_client", "boolean", (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn("segment", "text", (col) =>
      col.check(oneOf("segment", ["fnb", "gaso"])),
    )
    .addColumn("credit_line", sql`numeric(12, 2)`)
    .addColumn("nse", "integer")
    .addColumn("age", "integer")
    .addColumn("context_data", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn("current_state", "text", (col) =>
      col.generatedAlwaysAs(sql`context_data #>> '{phase,phase}'`).stored(),
    )
    .addColumn("status", "text", (col) =>
      col
        .notNull()
        .defaultTo("active")
        .check(oneOf("status", ["active", "human_takeover", "closed"])),
    )
    .addColumn("handover_reason", "text")
    .addColumn("is_simulation", "boolean", (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn("persona_id", "text")
    .addColumn("last_activity_at", "bigint", nowMs)
    .addColumn("products_interested", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn("delivery_address", "text")
    .addColumn("delivery_reference", "text")
    .addColumn("assigned_agent", "text", (col) => col.references("users.id"))
    .addColumn("agent_notes", "text")
    .addColumn("sale_status", "text", (col) =>
      col
        .notNull()
        .defaultTo("pending")
        .check(
          oneOf("sale_status", [
            "pending",
            "confirmed",
            "rejected",
            "no_answer",
          ]),
        ),
    )
    .addColumn("recording_contract_asset_id", "text")
    .addColumn("recording_audio_asset_id", "text")
    .addColumn("recording_uploaded_at", "bigint")
    .addColumn("assignment_notified_at", "bigint")
    .addPrimaryKeyConstraint("conversations_pkey", [
      "tenant_id",
      "channel_account_id",
      "phone_number",
    ])
    .addForeignKeyConstraint(
      "conversations_channel_account_fkey",
      ["channel_account_id", "tenant_id"],
      "channel_accounts",
      ["id", "tenant_id"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("idx_conversations_updated")
    .on("conversations")
    .columns(["tenant_id", "last_activity_at desc"])
    .execute();
  await db.schema
    .createIndex("idx_conversations_status")
    .on("conversations")
    .columns(["tenant_id", "status"])
    .execute();
  await db.schema
    .createIndex("idx_conversations_assigned")
    .on("conversations")
    .columns(["tenant_id", "assigned_agent"])
    .execute();
  await db.schema
    .createIndex("idx_conversations_phone")
    .on("conversations")
    .column("phone_number")
    .execute();

  // A row means the person holding the conversation has been alerted and has
  // not answered since. An escalation or a customer message adds it. A manual
  // reply, a change of the assigned agent, a reset or an undelivered alert
  // removes it.
  await db.schema
    .createTable("unread_alerts")
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("channel_account_id", "text", (col) => col.notNull())
    .addColumn("phone_number", "text", (col) => col.notNull())
    .addColumn("alerted_at", "bigint", (col) => col.notNull())
    .addPrimaryKeyConstraint("unread_alerts_pkey", [
      "tenant_id",
      "channel_account_id",
      "phone_number",
    ])
    .addForeignKeyConstraint(
      "unread_alerts_channel_account_fkey",
      ["channel_account_id", "tenant_id"],
      "channel_accounts",
      ["id", "tenant_id"],
      (fk) => fk.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "unread_alerts_conversation_fkey",
      ["tenant_id", "channel_account_id", "phone_number"],
      "conversations",
      ["tenant_id", "channel_account_id", "phone_number"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();

  // Any statement that sets `assigned_agent` hands the conversation to someone
  // who has not been alerted about it: assignment, reassignment, decline,
  // takeover, release, an agent's removal. This one trigger covers every writer.
  await sql`
    create function clear_unread_alert_on_assignment() returns trigger
    language plpgsql as $$
    begin
      delete from unread_alerts
      where tenant_id = new.tenant_id
        and channel_account_id = new.channel_account_id
        and phone_number = new.phone_number;
      return new;
    end
    $$
  `.execute(db);
  await sql`
    create trigger conversations_assignment_clears_unread_alert
    after update of assigned_agent on conversations
    for each row execute function clear_unread_alert_on_assignment()
  `.execute(db);

  await db.schema
    .createTable("messages")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("channel_account_id", "text", (col) => col.notNull())
    .addColumn("phone_number", "text", (col) => col.notNull())
    .addColumn("direction", "text", (col) =>
      col.notNull().check(oneOf("direction", ["inbound", "outbound"])),
    )
    .addColumn("type", "text", (col) =>
      col.notNull().check(oneOf("type", ["text", "image"])),
    )
    .addColumn("content", "text")
    .addColumn("whatsapp_message_id", "text")
    .addColumn("product_id", "text")
    .addColumn("status", "text", (col) => col.notNull().defaultTo("sent"))
    .addColumn("created_at", "bigint", nowMs)
    .addForeignKeyConstraint(
      "messages_channel_account_fkey",
      ["channel_account_id", "tenant_id"],
      "channel_accounts",
      ["id", "tenant_id"],
      (fk) => fk.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "messages_conversation_fkey",
      ["tenant_id", "channel_account_id", "phone_number"],
      "conversations",
      ["tenant_id", "channel_account_id", "phone_number"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("idx_messages_phone")
    .on("messages")
    .columns([
      "tenant_id",
      "channel_account_id",
      "phone_number",
      "created_at desc",
    ])
    .execute();
  await db.schema
    .createIndex("idx_messages_whatsapp_id")
    .on("messages")
    .column("whatsapp_message_id")
    .execute();

  // `attempts` counts turns that ended without a reply: a throw, or a process
  // that died. `handed_off_at` is NULL until the handoff of a `failed` row
  // alerts a person. Only that handoff writes it, and it is never cleared. The
  // states are in conversation/message-inbox.ts.
  await db.schema
    .createTable("message_inbox")
    .addColumn("id", "integer", (col) =>
      col.generatedAlwaysAsIdentity().primaryKey(),
    )
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("channel_account_id", "text", (col) => col.notNull())
    .addColumn("phone_number", "text", (col) => col.notNull())
    .addColumn("message_text", "text", (col) => col.notNull())
    .addColumn("message_id", "text", (col) => col.notNull().unique())
    .addColumn("whatsapp_timestamp", "bigint", (col) => col.notNull())
    .addColumn("quoted_message_context", "jsonb")
    .addColumn("status", "text", (col) =>
      col
        .notNull()
        .defaultTo("pending")
        .check(
          oneOf("status", ["pending", "processing", "processed", "failed"]),
        ),
    )
    .addColumn("last_error", "text")
    .addColumn("attempts", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("handed_off_at", "bigint")
    .addColumn("created_at", "bigint", nowMs)
    .addColumn("processed_at", "bigint")
    .addForeignKeyConstraint(
      "message_inbox_channel_account_fkey",
      ["channel_account_id", "tenant_id"],
      "channel_accounts",
      ["id", "tenant_id"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("idx_message_inbox_pending")
    .on("message_inbox")
    .columns([
      "status",
      "tenant_id",
      "channel_account_id",
      "phone_number",
      "created_at",
    ])
    .execute();

  // One outbound reply whose send failed and may still go out. `message_id` is
  // the `messages` row this row updates, so a retry never writes a second row,
  // and it is where the product an image showed is recorded. `handed_off_at` is
  // NULL until the handoff of a `failed` row alerts a person. Only that handoff
  // writes it, only on a `failed` row, and it is never cleared. The states and
  // who moves them are in conversation/outbox.ts.
  await db.schema
    .createTable("outbox")
    .addColumn("id", "integer", (col) =>
      col.generatedAlwaysAsIdentity().primaryKey(),
    )
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("channel_account_id", "text", (col) => col.notNull())
    .addColumn("phone_number", "text", (col) => col.notNull())
    .addColumn("message_id", "text", (col) => col.notNull())
    .addColumn("type", "text", (col) =>
      col.notNull().check(oneOf("type", ["text", "image"])),
    )
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("caption", "text")
    .addColumn("status", "text", (col) =>
      col
        .notNull()
        .defaultTo("pending")
        .check(
          oneOf("status", [
            "pending",
            "sending",
            "sent",
            "failed",
            "cancelled",
          ]),
        ),
    )
    .addColumn("attempts", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("ambiguous_attempts", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn("last_kind", "text")
    .addColumn("last_reason", "text")
    .addColumn("next_attempt_at", "bigint", (col) => col.notNull())
    .addColumn("created_at", "bigint", nowMs)
    .addColumn("updated_at", "bigint", nowMs)
    .addColumn("handed_off_at", "bigint")
    .addForeignKeyConstraint(
      "outbox_channel_account_fkey",
      ["channel_account_id", "tenant_id"],
      "channel_accounts",
      ["id", "tenant_id"],
      (fk) => fk.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "outbox_conversation_fkey",
      ["tenant_id", "channel_account_id", "phone_number"],
      "conversations",
      ["tenant_id", "channel_account_id", "phone_number"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("idx_outbox_due")
    .on("outbox")
    .columns(["status", "next_attempt_at"])
    .execute();
  await db.schema
    .createIndex("idx_outbox_conversation")
    .on("outbox")
    .columns([
      "tenant_id",
      "channel_account_id",
      "phone_number",
      "status",
      "id",
    ])
    .execute();

  await db.schema
    .createTable("orders")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("channel_account_id", "text", (col) => col.notNull())
    .addColumn("order_number", "text", (col) => col.notNull())
    .addColumn("conversation_phone", "text", (col) => col.notNull())
    .addColumn("client_name", "text", (col) => col.notNull())
    .addColumn("client_dni", "text", (col) => col.notNull())
    .addColumn("products", "jsonb", (col) => col.notNull())
    .addColumn("total_amount", sql`numeric(12, 2)`, (col) => col.notNull())
    .addColumn("delivery_address", "text", (col) => col.notNull())
    .addColumn("delivery_reference", "text")
    .addColumn("status", "text", (col) =>
      col
        .notNull()
        .defaultTo("pending")
        .check(
          oneOf("status", [
            "pending",
            "supervisor_approved",
            "supervisor_rejected",
            "calidda_approved",
            "calidda_rejected",
            "delivered",
          ]),
        ),
    )
    .addColumn("assigned_agent", "text", (col) => col.references("users.id"))
    .addColumn("supervisor_notes", "text")
    .addColumn("calidda_notes", "text")
    .addColumn("created_at", "bigint", nowMs)
    .addColumn("updated_at", "bigint", nowMs)
    .addUniqueConstraint("orders_tenant_number_key", [
      "tenant_id",
      "order_number",
    ])
    .addForeignKeyConstraint(
      "orders_channel_account_fkey",
      ["channel_account_id", "tenant_id"],
      "channel_accounts",
      ["id", "tenant_id"],
      (fk) => fk.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "orders_conversation_fkey",
      ["tenant_id", "channel_account_id", "conversation_phone"],
      "conversations",
      ["tenant_id", "channel_account_id", "phone_number"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("idx_orders_status")
    .on("orders")
    .columns(["tenant_id", "status", "created_at desc"])
    .execute();
  await db.schema
    .createIndex("idx_orders_conversation")
    .on("orders")
    .columns(["tenant_id", "channel_account_id", "conversation_phone"])
    .execute();
  await db.schema
    .createIndex("idx_orders_agent")
    .on("orders")
    .columns(["tenant_id", "assigned_agent"])
    .execute();

  // `id` is typed in by the tenant's own users ("cliente_moroso"), so it is
  // unique only inside a tenant. Two businesses naming a persona the same way
  // is ordinary, and a global primary key would reject the second one.
  await db.schema
    .createTable("test_personas")
    .addColumn("id", "text", (col) => col.notNull())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("description", "text")
    .addColumn("segment", "text", (col) =>
      col.notNull().check(oneOf("segment", ["fnb", "gaso", "not_eligible"])),
    )
    .addColumn("client_name", "text", (col) => col.notNull())
    .addColumn("dni", "text", (col) => col.notNull())
    .addColumn("credit_line", sql`numeric(12, 2)`, (col) => col.notNull())
    .addColumn("nse", "integer")
    .addColumn("is_active", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("created_by", "text", (col) => col.references("users.id"))
    .addColumn("created_at", "bigint", nowMs)
    .addPrimaryKeyConstraint("test_personas_pkey", ["tenant_id", "id"])
    .execute();
  await db.schema
    .createIndex("idx_personas_tenant")
    .on("test_personas")
    .columns(["tenant_id", "is_active"])
    .execute();

  // 'public' bytes need no session: Meta's servers fetch catalog images with no
  // credentials. 'private' bytes are only reachable through /api/assets/:id,
  // which checks tenant scope. `content_type` is null or a type the kind's
  // allowlist in domains/assets/content-types.ts accepts.
  await db.schema
    .createTable("assets")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("kind", "text", (col) =>
      col
        .notNull()
        .check(oneOf("kind", ["catalog_image", "contract", "recording"])),
    )
    .addColumn("visibility", "text", (col) =>
      col.notNull().check(oneOf("visibility", ["public", "private"])),
    )
    .addColumn("storage_key", "text", (col) => col.notNull())
    .addColumn("content_type", "text")
    .addColumn("byte_size", "bigint")
    .addColumn("created_by", "text", (col) => col.references("users.id"))
    .addColumn("created_at", "bigint", nowMs)
    .execute();
  await db.schema
    .createIndex("idx_assets_tenant")
    .on("assets")
    .columns(["tenant_id", "kind"])
    .execute();

  await db.schema
    .createTable("analytics_events")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("channel_account_id", "text", (col) => col.notNull())
    .addColumn("phone_number", "text", (col) => col.notNull())
    .addColumn("event_type", "text", (col) => col.notNull())
    .addColumn("metadata", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn("is_simulation", "boolean", (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn("created_at", "bigint", nowMs)
    .addForeignKeyConstraint(
      "analytics_events_channel_account_fkey",
      ["channel_account_id", "tenant_id"],
      "channel_accounts",
      ["id", "tenant_id"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("idx_analytics_phone")
    .on("analytics_events")
    .columns(["tenant_id", "channel_account_id", "phone_number"])
    .execute();
  await db.schema
    .createIndex("idx_analytics_type")
    .on("analytics_events")
    .columns(["tenant_id", "event_type"])
    .execute();

  await db.schema
    .createTable("llm_calls")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("channel_account_id", "text", (col) => col.notNull())
    .addColumn("phone_number", "text", (col) => col.notNull())
    .addColumn("operation", "text", (col) => col.notNull())
    .addColumn("model", "text", (col) => col.notNull())
    .addColumn("prompt", "text", (col) => col.notNull())
    .addColumn("user_message", "text", (col) => col.notNull())
    .addColumn("response", "text")
    .addColumn("status", "text", (col) =>
      col.notNull().check(oneOf("status", ["success", "error"])),
    )
    .addColumn("error_type", "text")
    .addColumn("error_message", "text")
    .addColumn("latency_ms", "integer")
    .addColumn("tokens_prompt", "integer")
    .addColumn("tokens_completion", "integer")
    .addColumn("tokens_total", "integer")
    .addColumn("conversation_phase", "text")
    .addColumn("context_metadata", "jsonb")
    .addColumn("created_at", "bigint", nowMs)
    .addForeignKeyConstraint(
      "llm_calls_channel_account_fkey",
      ["channel_account_id", "tenant_id"],
      "channel_accounts",
      ["id", "tenant_id"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createIndex("idx_llm_calls_phone")
    .on("llm_calls")
    .columns(["tenant_id", "phone_number", "created_at desc"])
    .execute();
  await db.schema
    .createIndex("idx_llm_calls_operation")
    .on("llm_calls")
    .columns(["tenant_id", "operation", "created_at desc"])
    .execute();
  await db.schema
    .createIndex("idx_llm_calls_status")
    .on("llm_calls")
    .columns(["tenant_id", "status", "created_at desc"])
    .execute();
  await db.schema
    .createIndex("idx_llm_calls_created")
    .on("llm_calls")
    .columns(["tenant_id", "created_at desc"])
    .execute();

  // `tenant_id` is null for a few events, such as provider outages affecting the
  // whole platform, that are not attributable to one tenant. The alert goes out
  // on the platform operations account (`ChannelAccountService.getPlatformOps`).
  // The trace is marked failed when no such account is configured.
  await db.schema
    .createTable("notification_traces")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.references("tenants.id").onDelete("cascade"),
    )
    .addColumn("trace_id", "text", (col) => col.notNull())
    .addColumn("event_type", "text", (col) => col.notNull())
    .addColumn("rule_id", "text")
    .addColumn("status", "text", (col) =>
      col.notNull().check(oneOf("status", ["sent", "skipped", "failed"])),
    )
    .addColumn("reason", "text")
    .addColumn("content_snapshot", "text")
    .addColumn("created_at", "bigint", nowMs)
    .execute();
  await db.schema
    .createIndex("idx_notification_traces_trace_id")
    .on("notification_traces")
    .column("trace_id")
    .execute();
  await db.schema
    .createIndex("idx_notification_traces_created_at")
    .on("notification_traces")
    .columns(["tenant_id", "created_at desc"])
    .execute();

  // `tenant_id` is nullable: platform operators also act outside any tenant.
  // `user_id` is null for an action no user took. `actor` always says who did
  // it: `user:<user id>` for a person, `cli:<operating-system user>` for the
  // terminal.
  await db.schema
    .createTable("audit_log")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("tenant_id", "text", (col) =>
      col.references("tenants.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (col) => col.references("users.id"))
    .addColumn("actor", "text", (col) => col.notNull())
    .addColumn("action", "text", (col) => col.notNull())
    .addColumn("resource_type", "text", (col) => col.notNull())
    .addColumn("resource_id", "text")
    .addColumn("metadata", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn("created_at", "bigint", nowMs)
    .execute();
  await db.schema
    .createIndex("idx_audit_user")
    .on("audit_log")
    .columns(["user_id", "created_at desc"])
    .execute();
  await db.schema
    .createIndex("idx_audit_tenant")
    .on("audit_log")
    .columns(["tenant_id", "created_at desc"])
    .execute();

  // Genuinely global platform configuration: the shared Calidda provider kill
  // switches and the operations channel. Only platform operators may write it.
  await db.schema
    .createTable("system_settings")
    .addColumn("key", "text", (col) => col.primaryKey())
    .addColumn("value", "text", (col) => col.notNull())
    .addColumn("updated_at", "bigint", nowMs)
    .execute();

  // Per-tenant configuration (agent round-robin cursor).
  await db.schema
    .createTable("tenant_settings")
    .addColumn("tenant_id", "text", (col) =>
      col.notNull().references("tenants.id").onDelete("cascade"),
    )
    .addColumn("key", "text", (col) => col.notNull())
    .addColumn("value", "text", (col) => col.notNull())
    .addColumn("updated_at", "bigint", nowMs)
    .addPrimaryKeyConstraint("tenant_settings_pkey", ["tenant_id", "key"])
    .execute();
}

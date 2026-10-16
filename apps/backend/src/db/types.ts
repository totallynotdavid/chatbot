import type { ColumnType, Generated, GeneratedAlways } from "kysely";
import type {
  AssetKind,
  AssetVisibility,
  BundleComposition,
  ChannelAccountStatus,
  ChannelType,
  ConversationStatus,
  InstallmentSchedule,
  OrderStatus,
  PeriodStatus,
  ProductSpecs,
  QuotedMessageContext,
  SaleStatus,
  Segment,
  StockStatus,
  StoredMessageType,
  TenantStatus,
  UserRole,
} from "@vendeya/types";

// The tables of `migrations/0001_baseline.ts`. Edit both together: `tsc`
// checks a query against this file, and Postgres checks it against the tables.

/**
 * A `bigint` of epoch milliseconds. The pool parses `int8` to a number, so a
 * value read is a number. Every timestamp column in the baseline is one.
 */
type EpochMs = number;

/** A timestamp the database fills in with the current time when omitted. */
type EpochMsNow = Generated<EpochMs>;

/**
 * A `numeric(12, 2)`, parsed to a number by the pool.
 */
type Money = number;

/**
 * A `jsonb` column. A read gives the parsed value. A write takes a string the
 * caller has run through `JSON.stringify`: `pg` turns a bare array into a
 * Postgres array literal, which `jsonb` rejects.
 */
type Json<T> = ColumnType<T, string, string>;
type JsonDefaulted<T> = ColumnType<T, string | undefined, string>;
type JsonNullable<T> = ColumnType<
  T | null,
  string | null | undefined,
  string | null
>;

export interface TenantsTable {
  id: string;
  slug: string;
  name: string;
  status: Generated<TenantStatus>;
  created_at: EpochMsNow;
  updated_at: EpochMsNow;
}

export interface UsersTable {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  name: string;
  phone_number: string | null;
  is_platform_operator: Generated<boolean>;
  is_active: Generated<boolean>;
  created_at: EpochMsNow;
  created_by: string | null;
}

export interface TenantMembershipsTable {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
  is_available: Generated<boolean>;
  created_at: EpochMsNow;
  created_by: string | null;
}

export interface SessionTable {
  id: string;
  user_id: string;
  active_tenant_id: string | null;
  expires_at: EpochMs;
}

export interface ChannelSecretsTable {
  id: string;
  tenant_id: string;
  purpose: "access_token" | "verify_token";
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_id: string;
  created_at: EpochMsNow;
  updated_at: EpochMsNow;
}

export interface ChannelAccountsTable {
  id: string;
  tenant_id: string;
  channel_type: Generated<ChannelType>;
  waba_id: string | null;
  phone_number_id: string;
  display_phone_number: string | null;
  label: string | null;
  access_token_secret_id: string | null;
  verify_token_secret_id: string | null;
  status: Generated<ChannelAccountStatus>;
  created_at: EpochMsNow;
  updated_at: EpochMsNow;
}

export interface CatalogPeriodsTable {
  id: string;
  tenant_id: string;
  name: string;
  year_month: string;
  status: Generated<PeriodStatus>;
  published_at: EpochMs | null;
  created_by: string | null;
  created_at: EpochMsNow;
}

export interface ProductsTable {
  id: string;
  tenant_id: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  specs_json: JsonNullable<ProductSpecs>;
  created_at: EpochMsNow;
}

export interface CatalogBundlesTable {
  id: string;
  tenant_id: string;
  period_id: string;
  segment: Segment;
  name: string;
  price: Money;
  primary_category: string;
  categories_json: JsonNullable<string[]>;
  image_id: string;
  composition_json: Json<BundleComposition>;
  installments_json: Json<InstallmentSchedule>;
  notes: Generated<string>;
  is_active: Generated<boolean>;
  stock_status: Generated<StockStatus>;
  created_by: string | null;
  created_at: EpochMsNow;
  updated_at: EpochMsNow;
}

export interface ConversationsTable {
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  client_name: string | null;
  dni: string | null;
  is_calidda_client: Generated<boolean>;
  segment: Segment | null;
  credit_line: Money | null;
  nse: number | null;
  age: number | null;
  context_data: JsonDefaulted<Record<string, unknown>>;
  /** Generated from `context_data.phase.phase`. */
  current_state: GeneratedAlways<string | null>;
  status: Generated<ConversationStatus>;
  handover_reason: string | null;
  is_simulation: Generated<boolean>;
  persona_id: string | null;
  last_activity_at: EpochMsNow;
  products_interested: JsonDefaulted<unknown[]>;
  delivery_address: string | null;
  delivery_reference: string | null;
  assigned_agent: string | null;
  agent_notes: string | null;
  sale_status: Generated<SaleStatus>;
  recording_contract_asset_id: string | null;
  recording_audio_asset_id: string | null;
  recording_uploaded_at: EpochMs | null;
  assignment_notified_at: EpochMs | null;
}

export interface UnreadAlertsTable {
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  alerted_at: EpochMs;
}

export interface MessagesTable {
  id: string;
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  direction: "inbound" | "outbound";
  type: StoredMessageType;
  content: string | null;
  whatsapp_message_id: string | null;
  product_id: string | null;
  status: Generated<string>;
  created_at: EpochMsNow;
}

export interface MessageInboxTable {
  id: GeneratedAlways<number>;
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  message_text: string;
  message_id: string;
  whatsapp_timestamp: EpochMs;
  quoted_message_context: JsonNullable<QuotedMessageContext>;
  status: Generated<"pending" | "processing" | "processed" | "failed">;
  last_error: string | null;
  attempts: Generated<number>;
  handed_off_at: EpochMs | null;
  created_at: EpochMsNow;
  processed_at: EpochMs | null;
}

export interface OutboxTable {
  id: GeneratedAlways<number>;
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  message_id: string;
  type: StoredMessageType;
  content: string;
  caption: string | null;
  status: Generated<"pending" | "sending" | "sent" | "failed" | "cancelled">;
  attempts: Generated<number>;
  ambiguous_attempts: Generated<number>;
  last_kind: string | null;
  last_reason: string | null;
  next_attempt_at: EpochMs;
  created_at: EpochMsNow;
  updated_at: EpochMsNow;
  handed_off_at: EpochMs | null;
}

export interface OrdersTable {
  id: string;
  tenant_id: string;
  channel_account_id: string;
  order_number: string;
  conversation_phone: string;
  client_name: string;
  client_dni: string;
  products: Json<unknown>;
  total_amount: Money;
  delivery_address: string;
  delivery_reference: string | null;
  status: Generated<OrderStatus>;
  assigned_agent: string | null;
  supervisor_notes: string | null;
  calidda_notes: string | null;
  created_at: EpochMsNow;
  updated_at: EpochMsNow;
}

export interface TestPersonasTable {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  segment: Segment | "not_eligible";
  client_name: string;
  dni: string;
  credit_line: Money;
  nse: number | null;
  is_active: Generated<boolean>;
  created_by: string | null;
  created_at: EpochMsNow;
}

export interface AssetsTable {
  id: string;
  tenant_id: string;
  kind: AssetKind;
  visibility: AssetVisibility;
  storage_key: string;
  content_type: string | null;
  byte_size: number | null;
  created_by: string | null;
  created_at: EpochMsNow;
}

export interface AnalyticsEventsTable {
  id: string;
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  event_type: string;
  metadata: JsonDefaulted<Record<string, unknown>>;
  is_simulation: Generated<boolean>;
  created_at: EpochMsNow;
}

export interface LlmCallsTable {
  id: string;
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  operation: string;
  model: string;
  prompt: string;
  user_message: string;
  response: string | null;
  status: "success" | "error";
  error_type: string | null;
  error_message: string | null;
  latency_ms: number | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  tokens_total: number | null;
  conversation_phase: string | null;
  context_metadata: JsonNullable<Record<string, unknown>>;
  created_at: EpochMsNow;
}

export interface NotificationTracesTable {
  id: string;
  tenant_id: string | null;
  trace_id: string;
  event_type: string;
  rule_id: string | null;
  status: "sent" | "skipped" | "failed";
  reason: string | null;
  content_snapshot: string | null;
  created_at: EpochMsNow;
}

export interface AuditLogTable {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  actor: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: JsonDefaulted<Record<string, unknown>>;
  created_at: EpochMsNow;
}

export interface SystemSettingsTable {
  key: string;
  value: string;
  updated_at: EpochMsNow;
}

export interface TenantSettingsTable {
  tenant_id: string;
  key: string;
  value: string;
  updated_at: EpochMsNow;
}

export interface DB {
  tenants: TenantsTable;
  users: UsersTable;
  tenant_memberships: TenantMembershipsTable;
  session: SessionTable;
  channel_secrets: ChannelSecretsTable;
  channel_accounts: ChannelAccountsTable;
  catalog_periods: CatalogPeriodsTable;
  products: ProductsTable;
  catalog_bundles: CatalogBundlesTable;
  conversations: ConversationsTable;
  unread_alerts: UnreadAlertsTable;
  messages: MessagesTable;
  message_inbox: MessageInboxTable;
  outbox: OutboxTable;
  orders: OrdersTable;
  test_personas: TestPersonasTable;
  assets: AssetsTable;
  analytics_events: AnalyticsEventsTable;
  llm_calls: LlmCallsTable;
  notification_traces: NotificationTracesTable;
  audit_log: AuditLogTable;
  system_settings: SystemSettingsTable;
  tenant_settings: TenantSettingsTable;
}

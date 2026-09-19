import type { StoredMessageType } from "./whatsapp.ts";

export type Segment = "fnb" | "gaso";
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";
export type UserRole = "admin" | "developer" | "supervisor" | "sales_agent";
export type PeriodStatus = "draft" | "active" | "archived";

// Tenancy
/** Role a user holds inside one tenant. Platform operators hold none. */
export type TenantRole = UserRole;
export type TenantStatus = "active" | "suspended";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  created_at: number;
  updated_at: number;
};

export type TenantMembership = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  /** Whether the agent takes new conversations *in this tenant*. */
  is_available: number;
  created_at: number;
  created_by: string | null;
};

// Channel accounts
export type ChannelType = "whatsapp";
export type ChannelAccountStatus = "active" | "pending" | "disabled";

export type ChannelAccount = {
  id: string;
  tenant_id: string;
  channel_type: ChannelType;
  waba_id: string | null;
  phone_number_id: string;
  display_phone_number: string | null;
  label: string | null;
  access_token_secret_id: string | null;
  verify_token_secret_id: string | null;
  status: ChannelAccountStatus;
  created_at: number;
  updated_at: number;
};

/**
 * Identity of one conversation: which business, which of its numbers, and the
 * contact on the other end. The same contact phone number reaching two tenants
 * is two distinct conversations.
 */
export type ConversationRef = {
  tenantId: string;
  channelAccountId: string;
  phoneNumber: string;
};

// Assets
export type AssetKind = "catalog_image" | "contract" | "recording";
export type AssetVisibility = "public" | "private";

export type Asset = {
  id: string;
  tenant_id: string;
  kind: AssetKind;
  visibility: AssetVisibility;
  storage_key: string;
  content_type: string | null;
  byte_size: number | null;
  created_by: string | null;
  created_at: number;
};

// Catalog types
export type {
  Product,
  ProductSpecs,
  SnapshotProduct,
  BundleChoice,
  BundleChoiceOption,
  BundleComposition,
  InstallmentSchedule,
  Bundle,
  CategoryConfig,
  CategoryKey,
  CategoryGroup,
  CatalogSnapshot,
} from "./catalog.ts";
export { CATEGORIES, CATEGORY_GROUPS } from "./catalog.ts";
export { MIN_PASSWORD_LENGTH } from "./accounts.ts";

export type ConversationState =
  | "INIT"
  | "CONFIRM_CLIENT"
  | "COLLECT_DNI"
  | "WAITING_PROVIDER"
  | "COLLECT_AGE"
  | "OFFER_PRODUCTS"
  | "HANDLE_OBJECTION"
  | "CLOSING"
  | "ESCALATED";

export type ConversationStatus = "active" | "human_takeover" | "closed";
export type SaleStatus = "pending" | "confirmed" | "rejected" | "no_answer";
export type OrderStatus =
  | "pending"
  | "supervisor_approved"
  | "supervisor_rejected"
  | "calidda_approved"
  | "calidda_rejected"
  | "delivered";

export type Conversation = {
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  client_name: string | null;
  dni: string | null;
  is_calidda_client: number;
  segment: Segment | null;
  credit_line: number | null;
  nse: number | null;
  current_state: ConversationState;
  status: ConversationStatus;
  last_activity_at: number;
  context_data: string;
  handover_reason: string | null;
  is_simulation: number;
  persona_id: string | null;
  // Agent workflow fields
  products_interested: string;
  delivery_address: string | null;
  delivery_reference: string | null;
  assigned_agent: string | null;
  agent_notes: string | null;
  sale_status: SaleStatus;
  // Contract recording fields
  recording_contract_asset_id: string | null;
  recording_audio_asset_id: string | null;
  recording_uploaded_at: string | null;
  assignment_notified_at: string | null;
};

export type CatalogPeriod = {
  id: string;
  tenant_id: string;
  name: string;
  year_month: string;
  status: PeriodStatus;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type ConversationMessage = {
  id: string;
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  direction: "inbound" | "outbound";
  type: StoredMessageType;
  content: string;
  status: string;
  created_at: string;
};

export type User = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  name: string;
  phone_number: string | null;
  is_platform_operator: number;
  is_active: number;
  created_at: string;
  created_by: string | null;
};

export type AnalyticsEvent = {
  id: string;
  tenant_id: string;
  channel_account_id: string;
  phone_number: string;
  event_type: string;
  metadata: string;
  is_simulation: number;
  created_at: string;
};

export type AuditLog = {
  id: string;
  tenant_id: string | null;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: string;
  created_at: string;
};

export type Order = {
  id: string;
  tenant_id: string;
  channel_account_id: string;
  order_number: string;
  conversation_phone: string;
  client_name: string;
  client_dni: string;
  products: string;
  total_amount: number;
  delivery_address: string;
  delivery_reference: string | null;
  status: OrderStatus;
  assigned_agent: string | null;
  supervisor_notes: string | null;
  calidda_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProviderCheckResult = {
  eligible: boolean;
  credit: number;
  name?: string;
  nse?: number;
  reason?: string;
};

export type TestPersona = {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  segment: "fnb" | "gaso" | "not_eligible";
  clientName: string;
  dni: string;
  creditLine: number;
  nse?: number;
  isActive: boolean;
};

export type ReplayMetadata = {
  conversationId: string;
  clientName: string | null;
  segment: Segment | null;
  creditLine: number | null;
  finalState: ConversationState;
  messageCount: number;
  timestamp: string;
};

export type ReplayData = {
  conversation: Conversation;
  messages: ConversationMessage[];
  initialContext: Record<string, any>;
  metadata: ReplayMetadata;
};

// WhatsApp message types
export type {
  StoredMessageType,
  InboundMessageType,
  QuotedMessageContext,
  IncomingMessage,
} from "./whatsapp.ts";

export * from "./events.ts";

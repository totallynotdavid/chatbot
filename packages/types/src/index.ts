export type Segment = "fnb" | "gaso";
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";
export type UserRole = "admin" | "developer" | "supervisor" | "sales_agent";
export type PeriodStatus = "draft" | "active" | "archived";

// Catalog types (new bundle-based architecture)
export type {
  Product,
  ProductSpecs,
  SnapshotProduct,
  BundleChoice,
  BundleChoiceOption,
  BundleComposition,
  InstallmentSchedule,
  Bundle,
  FnbOffering,
} from "./catalog.ts";

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
  phone_number: string;
  client_name: string | null;
  dni: string | null;
  is_calidda_client: number;
  segment: Segment | null;
  credit_line: number | null;
  nse: number | null;
  current_state: ConversationState;
  status: ConversationStatus;
  last_activity_at: string;
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
  recording_contract_path: string | null;
  recording_audio_path: string | null;
  recording_uploaded_at: string | null;
  assignment_notified_at: string | null;
};

export type CatalogPeriod = {
  id: string;
  name: string;
  year_month: string;
  status: PeriodStatus;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  phone_number: string;
  direction: "inbound" | "outbound";
  type: "text" | "image";
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
  is_active: number;
  is_available: number;
  created_at: string;
  created_by: string | null;
};

export type AnalyticsEvent = {
  id: string;
  phone_number: string;
  event_type: string;
  metadata: string;
  is_simulation: number;
  created_at: string;
};

export type AuditLog = {
  id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: string;
  created_at: string;
};

export type Order = {
  id: string;
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
  messages: Message[];
  initialContext: Record<string, any>;
  metadata: ReplayMetadata;
};

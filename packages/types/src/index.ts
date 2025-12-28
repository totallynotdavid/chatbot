export type Segment = "fnb" | "gaso";
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";
export type UserRole = "admin" | "developer" | "sales_agent";

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
};

export type Product = {
    id: string;
    segment: Segment;
    category: string;
    name: string;
    description: string | null;
    price: number;
    installments: number | null;
    image_main_path: string;
    image_specs_path: string | null;
    is_active: number;
    stock_status: StockStatus;
    created_by: string;
    updated_at: string;
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
    is_active: number;
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

export type ProviderCheckResult = {
    eligible: boolean;
    credit: number;
    name?: string;
    nse?: number;
    reason?: string;
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

export type Segment = 'fnb' | 'gaso';
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type UserRole = 'admin' | 'editor' | 'viewer';

export type Product = {
  id: string;
  segment: Segment;
  category: string;
  name: string;
  description: string | null;
  price: number;
  image_main_path: string;
  image_specs_path: string | null;
  is_active: number; // 1 or 0
  stock_status: StockStatus;
  created_at: string;
};

export type ConversationState = 
  | 'INIT'
  | 'CONFIRM_CLIENT'
  | 'COLLECT_DNI'
  | 'CHECK_ELIGIBILITY'
  | 'COLLECT_AGE'
  | 'OFFER_PRODUCTS'
  | 'HANDLE_OBJECTION'
  | 'CLOSING'
  | 'ESCALATED';

export type ConversationStatus = 'active' | 'human_takeover' | 'closed';

export type Conversation = {
  phone_number: string;
  client_name: string | null;
  dni: string | null;
  is_calidda_client: number; // 1 or 0
  segment: Segment | null;
  credit_line: number | null;
  nse: number | null;
  current_state: ConversationState;
  status: ConversationStatus;
  last_activity_at: string;
  context_data: string; // JSON string
};

export type Message = {
  id: string;
  phone_number: string;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image';
  content: string;
  created_at: string;
};
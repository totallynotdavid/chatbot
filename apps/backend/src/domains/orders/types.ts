import type { ConversationRef } from "@vendeya/types";

export interface OrderItem {
  productId: string;
  name?: string;
  price: number;
  quantity: number;
}

export interface CreateOrderInput {
  /** Conversation the order came out of. It also fixes the owning tenant. */
  ref: ConversationRef;
  clientName: string;
  clientDni: string;
  products: OrderItem[];
  totalAmount: number;
  deliveryAddress: string;
  deliveryReference?: string;
  assignedAgent?: string;
}

export interface OrderFilters {
  status?: string;
  /** Inclusive bounds on `created_at`, in ms. */
  startMs?: number;
  endMs?: number;
  /** The agent recorded on the order itself, as a filter the caller picks. */
  assignedAgent?: string;
  /**
   * Only orders whose conversation is assigned to this user. This is the
   * sales agent's scope, set by the route from the caller, not a filter.
   */
  conversationAgent?: string | null;
  limit?: number;
  offset?: number;
}

export interface OrderMetrics {
  totalOrders: number;
  pendingCount: number;
  supervisorApprovedCount: number;
  calidaApprovedCount: number;
  deliveredCount: number;
  rejectedCount: number;
  totalRevenue: number;
  revenueThisMonth: number;
  avgOrderValue: number;
  approvalRate: number;
  rejectionRate: number;
}

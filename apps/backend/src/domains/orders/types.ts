import type { ConversationRef } from "@totem/types";

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
  startDate?: string;
  endDate?: string;
  assignedAgent?: string;
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

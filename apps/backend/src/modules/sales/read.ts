import { getOne, getAll } from "../../db/query.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import type { Order } from "@totem/types";
import type { OrderFilters, OrderMetrics } from "./types.ts";

const MS_PER_DAY = 86400000;

export function getOrders(filters: OrderFilters = {}): Order[] {
  let query = "SELECT * FROM orders WHERE 1=1";
  const params: SQLQueryBindings[] = [];

  if (filters.status) {
    query += " AND status = ?";
    params.push(filters.status);
  }

  if (filters.startDate) {
    const startTs = new Date(filters.startDate).getTime();
    query += " AND created_at >= ?";
    params.push(startTs);
  }

  if (filters.endDate) {
    const endTs = new Date(filters.endDate).getTime() + MS_PER_DAY;
    query += " AND created_at < ?";
    params.push(endTs);
  }

  if (filters.assignedAgent) {
    query += " AND assigned_agent = ?";
    params.push(filters.assignedAgent);
  }

  query += " ORDER BY created_at DESC";

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;
  query += " LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = getAll<Order>(query, params);
  return rows;
}

export function getOrderById(id: string): Order | null {
  return getOne<Order>("SELECT * FROM orders WHERE id = ?", [id]) || null;
}

export function getOrderByConversation(phone: string): Order | null {
  return (
    getOne<Order>(
      "SELECT * FROM orders WHERE conversation_phone = ? ORDER BY created_at DESC LIMIT 1",
      [phone],
    ) || null
  );
}

export function getOrderMetrics(): OrderMetrics {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const totalOrders = getOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM orders",
  )!.count;

  const pendingCount = getOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM orders WHERE status = 'pending'",
  )!.count;

  const supervisorApprovedCount = getOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM orders WHERE status = 'supervisor_approved'",
  )!.count;

  const calidaApprovedCount = getOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM orders WHERE status = 'calidda_approved'",
  )!.count;

  const deliveredCount = getOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM orders WHERE status = 'delivered'",
  )!.count;

  const rejectedCount = getOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM orders WHERE status LIKE '%rejected%'",
  )!.count;

  const totalRevenue = getOne<{ revenue: number }>(
    "SELECT COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE status = 'delivered'",
  )!.revenue;

  const revenueThisMonth = getOne<{ revenue: number }>(
    "SELECT COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE status = 'delivered' AND created_at >= ?",
    [thirtyDaysAgo],
  )!.revenue;

  const avgOrderValue =
    deliveredCount > 0 ? totalRevenue / deliveredCount : 0;

  const approvalRate =
    totalOrders > 0
      ? ((deliveredCount + calidaApprovedCount) / totalOrders) * 100
      : 0;

  const rejectionRate =
    totalOrders > 0 ? (rejectedCount / totalOrders) * 100 : 0;

  return {
    totalOrders,
    pendingCount,
    supervisorApprovedCount,
    calidaApprovedCount,
    deliveredCount,
    rejectedCount,
    totalRevenue,
    revenueThisMonth,
    avgOrderValue,
    approvalRate,
    rejectionRate,
  };
}

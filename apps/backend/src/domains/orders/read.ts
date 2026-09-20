import { getOne, getAll, tenantPredicate } from "../../db/query.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import type { ConversationRef, Order } from "@totem/types";
import type { OrderFilters, OrderMetrics } from "./types.ts";

/**
 * A null `tenantId` reads across open tenants. Route handlers pass the caller's
 * scope, so only an unpinned platform operator reaches that case.
 */
export function getOrders(
  tenantId: string | null,
  filters: OrderFilters = {},
): Order[] {
  let query = "SELECT * FROM orders WHERE 1=1";
  const params: SQLQueryBindings[] = [];

  query += ` AND ${tenantPredicate(tenantId)}`;
  if (tenantId) params.push(tenantId);

  if (filters.status) {
    query += " AND status = ?";
    params.push(filters.status);
  }

  if (filters.startMs !== undefined) {
    query += " AND created_at >= ?";
    params.push(filters.startMs);
  }

  if (filters.endMs !== undefined) {
    query += " AND created_at <= ?";
    params.push(filters.endMs);
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

export function getOrderById(
  tenantId: string | null,
  id: string,
): Order | null {
  return (
    getOne<Order>(
      `SELECT * FROM orders WHERE id = ? AND ${tenantPredicate(tenantId)}`,
      tenantId ? [id, tenantId] : [id],
    ) ?? null
  );
}

export function getOrderByConversation(ref: ConversationRef): Order | null {
  return (
    getOne<Order>(
      `SELECT * FROM orders
       WHERE tenant_id = ? AND channel_account_id = ? AND conversation_phone = ?
       ORDER BY created_at DESC LIMIT 1`,
      [ref.tenantId, ref.channelAccountId, ref.phoneNumber],
    ) ?? null
  );
}

export function getOrderMetrics(tenantId: string | null): OrderMetrics {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const scope = tenantPredicate(tenantId);
  const scopeParams: SQLQueryBindings[] = tenantId ? [tenantId] : [];

  const count = (extra: string, params: SQLQueryBindings[] = []): number =>
    getOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM orders WHERE ${scope}${extra}`,
      [...scopeParams, ...params],
    )!.count;

  const revenue = (extra: string, params: SQLQueryBindings[] = []): number =>
    getOne<{ revenue: number }>(
      `SELECT COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE ${scope}${extra}`,
      [...scopeParams, ...params],
    )!.revenue;

  const totalOrders = count("");
  const pendingCount = count(" AND status = 'pending'");
  const supervisorApprovedCount = count(" AND status = 'supervisor_approved'");
  const calidaApprovedCount = count(" AND status = 'calidda_approved'");
  const deliveredCount = count(" AND status = 'delivered'");
  const rejectedCount = count(" AND status LIKE '%rejected%'");

  const totalRevenue = revenue(" AND status = 'delivered'");
  const revenueThisMonth = revenue(
    " AND status = 'delivered' AND created_at >= ?",
    [thirtyDaysAgo],
  );

  const avgOrderValue = deliveredCount > 0 ? totalRevenue / deliveredCount : 0;

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

import { db } from "../../db/index.ts";
import { getAll, getOne, tenantPredicate } from "../../db/query.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import type { AnalyticsEvent, ConversationRef } from "@totem/types";

export function trackEvent(
  ref: ConversationRef,
  eventType: string,
  metadata: Record<string, any> = {},
): void {
  const id = crypto.randomUUID();
  const metadataJson = JSON.stringify(metadata);

  const conv = getOne<{ is_simulation: number }>(
    `SELECT is_simulation FROM conversations
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?`,
    [ref.tenantId, ref.channelAccountId, ref.phoneNumber],
  );

  const isSimulation = conv?.is_simulation || 0;

  db.prepare(
    `INSERT INTO analytics_events (id, tenant_id, channel_account_id, phone_number, event_type, metadata, is_simulation)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    ref.tenantId,
    ref.channelAccountId,
    ref.phoneNumber,
    eventType,
    metadataJson,
    isSimulation,
  );
}

/** `tenantId` null aggregates across tenants (platform operators only). */
export function getFunnelStats(
  tenantId: string | null,
  startDate?: string,
  endDate?: string,
  includeSimulations = false,
) {
  const start = startDate
    ? new Date(startDate).getTime()
    : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const end = endDate ? new Date(endDate).getTime() : Date.now();

  const conditions = ["created_at BETWEEN ? AND ?"];
  const params: SQLQueryBindings[] = [start, end];

  if (!includeSimulations) {
    conditions.push("is_simulation = 0");
  }
  conditions.push(tenantPredicate(tenantId));
  if (tenantId) params.push(tenantId);

  const events = getAll<{ event_type: string; count: number }>(
    `SELECT event_type, COUNT(*) as count
     FROM analytics_events
     WHERE ${conditions.join(" AND ")}
     GROUP BY event_type`,
    params,
  );

  const stats: Record<string, number> = {};
  events.forEach((e) => {
    stats[e.event_type] = e.count;
  });

  return {
    sessions_started: stats.session_start || 0,
    dni_collected: stats.dni_collected || 0,
    eligibility_passed: stats.eligibility_passed || 0,
    eligibility_failed: stats.eligibility_failed || 0,
    products_offered: stats.products_offered || 0,
    conversions: stats.conversion || 0,
  };
}

export function getRecentEvents(
  tenantId: string | null,
  limit: number = 50,
  includeSimulations = false,
): AnalyticsEvent[] {
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (!includeSimulations) {
    conditions.push("is_simulation = 0");
  }
  conditions.push(tenantPredicate(tenantId));
  if (tenantId) params.push(tenantId);

  params.push(limit);

  return getAll<AnalyticsEvent>(
    `SELECT * FROM analytics_events
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
  );
}

export function getEventsByConversation(
  ref: ConversationRef,
): AnalyticsEvent[] {
  return getAll<AnalyticsEvent>(
    `SELECT * FROM analytics_events
     WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?
     ORDER BY created_at ASC`,
    [ref.tenantId, ref.channelAccountId, ref.phoneNumber],
  );
}

import { db } from "../db/index.ts";
import type { AnalyticsEvent } from "@totem/types";

export function trackEvent(
    phoneNumber: string,
    eventType: string,
    metadata: Record<string, any> = {},
): void {
    const id = crypto.randomUUID();
    const metadataJson = JSON.stringify(metadata);

    const conv = db
        .prepare("SELECT is_simulation FROM conversations WHERE phone_number = ?")
        .get(phoneNumber) as { is_simulation: number } | undefined;

    const isSimulation = conv?.is_simulation || 0;

    db.prepare(
        `INSERT INTO analytics_events (id, phone_number, event_type, metadata, is_simulation) 
     VALUES (?, ?, ?, ?, ?)`,
    ).run(id, phoneNumber, eventType, metadataJson, isSimulation);
}

export function getFunnelStats(startDate?: string, endDate?: string, includeSimulations = false) {
    const start =
        startDate ||
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const end = endDate || new Date().toISOString();

    const whereClause = includeSimulations
        ? "WHERE created_at BETWEEN ? AND ?"
        : "WHERE created_at BETWEEN ? AND ? AND is_simulation = 0";

    const events = db
        .prepare(
            `SELECT event_type, COUNT(*) as count 
             FROM analytics_events 
             ${whereClause}
             GROUP BY event_type`,
        )
        .all(start, end) as Array<{ event_type: string; count: number }>;

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

export function getRecentEvents(limit: number = 50, includeSimulations = false): AnalyticsEvent[] {
    const whereClause = includeSimulations ? "" : "WHERE is_simulation = 0";
    return db
        .prepare(
            `SELECT * FROM analytics_events 
       ${whereClause}
       ORDER BY created_at DESC 
       LIMIT ?`,
        )
        .all(limit) as AnalyticsEvent[];
}

export function getEventsByPhone(phoneNumber: string): AnalyticsEvent[] {
    return db
        .prepare(
            `SELECT * FROM analytics_events 
       WHERE phone_number = ? 
       ORDER BY created_at ASC`,
        )
        .all(phoneNumber) as AnalyticsEvent[];
}

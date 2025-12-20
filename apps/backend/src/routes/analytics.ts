// Analytics routes

import { Hono } from "hono";
import { getFunnelStats, getRecentEvents } from "../services/analytics.ts";

const analytics = new Hono();

// Get funnel statistics
analytics.get("/funnel", (c) => {
    const startDate = c.req.query("start");
    const endDate = c.req.query("end");

    const stats = getFunnelStats(startDate, endDate);

    return c.json({
        stats,
        period: {
            start: startDate || "7 days ago",
            end: endDate || "now",
        },
    });
});

// Get recent events
analytics.get("/events", (c) => {
    const limitStr = c.req.query("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 50;

    const events = getRecentEvents(limit);

    return c.json({ events });
});

export default analytics;

// Analytics routes

import { Hono } from "hono";
import { getFunnelStats, getRecentEvents } from "../domains/analytics/index.ts";
import { requireTenantScope } from "../middleware/auth.ts";

const analytics = new Hono();

analytics.use("/*", requireTenantScope);

// Get funnel statistics
analytics.get("/funnel", (c) => {
  const startDate = c.req.query("start");
  const endDate = c.req.query("end");
  const includeSimulations = c.req.query("includeSimulations") === "true";

  const stats = getFunnelStats(
    c.get("scope").tenantId,
    startDate,
    endDate,
    includeSimulations,
  );

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
  const includeSimulations = c.req.query("includeSimulations") === "true";

  const events = getRecentEvents(
    c.get("scope").tenantId,
    limit,
    includeSimulations,
  );

  return c.json({ events });
});

export default analytics;

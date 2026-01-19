import { Hono } from "hono";
import {
  getLLMErrorStats,
  getRecentLLMCalls,
} from "../intelligence/tracker.ts";

const app = new Hono();

app.get("/stats", (c) => {
  try {
    const stats = getLLMErrorStats(24);
    const recentCalls = getRecentLLMCalls(50);

    return c.json({
      stats,
      recentCalls,
    });
  } catch (error) {
    console.error("Error fetching LLM stats:", error);
    return c.json({ error: "Failed to fetch stats" }, 500);
  }
});

export default app;

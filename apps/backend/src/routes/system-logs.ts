import { Hono } from "hono";
import { SystemLogService } from "../domains/system/logs.ts";

const app = new Hono();

app.get("/", (c) => {
  try {
    const limit = Number(c.req.query("limit")) || 100;
    const logs = SystemLogService.getRecentLogs(limit);
    return c.json({ logs });
  } catch (error) {
    console.error("Error fetching system logs:", error);
    return c.json({ error: "Failed to fetch system logs" }, 500);
  }
});

export default app;

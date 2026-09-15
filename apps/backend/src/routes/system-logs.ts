import { Hono } from "hono";
import { SystemLogService } from "../domains/system/logs.ts";
import { requireTenantScope } from "../middleware/auth.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("system-logs");

const app = new Hono();

app.use("/*", requireTenantScope);

app.get("/", (c) => {
  try {
    const limit = Number(c.req.query("limit")) || 100;
    const logs = SystemLogService.getRecentLogs(c.get("scope").tenantId, limit);
    return c.json({ logs });
  } catch (error) {
    logger.error({ error }, "Error fetching system logs");
    return c.json({ error: "Failed to fetch system logs" }, 500);
  }
});

export default app;

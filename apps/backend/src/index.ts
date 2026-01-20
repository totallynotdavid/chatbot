import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import process from "node:process";
import { createLogger } from "./lib/logger.ts";
import { getFrontendUrl } from "@totem/utils";
import {
  startAggregatorWorker,
  stopAggregatorWorker,
} from "./conversation/aggregator-worker.ts";

const logger = createLogger("app");

import { db } from "./db/index.ts";
import { initializeDatabase } from "./db/init.ts";
import { seedDatabase } from "./db/seed.ts";
import bcrypt from "bcryptjs";

import {
  generateSessionToken,
  createSession,
  invalidateSession,
  setSessionTokenCookie,
  deleteSessionTokenCookie,
} from "./platform/auth/session.ts";

import { requireAuth, requireRole } from "./middleware/auth.ts";
import { errorHandler } from "./middleware/error.ts";
import { securityHeaders, rateLimiter } from "./middleware/security.ts";

import webhook from "./routes/webhook.ts";
import simulator from "./routes/simulator.ts";
import conversations from "./routes/conversations.ts";
import analytics from "./routes/analytics.ts";
import admin from "./routes/admin.ts";
import catalog from "./routes/catalog.ts";
import periods from "./routes/periods.ts";
import orders from "./routes/orders.ts";
import systemLogs from "./routes/system-logs.ts";

import { getAllStatus } from "./adapters/providers/health.ts";
import { ReportService } from "./domains/reports/index.ts";
import { checkNotifierHealth } from "./adapters/notifier/client.ts";
import { checkAndReassignTimeouts } from "./domains/conversations/assignment.ts";
import { CheckEligibilityHandler } from "./domains/eligibility/handlers/check-eligibility-handler.ts";
import { initializeApplication } from "./bootstrap/index.ts";
import { isOk } from "./shared/result/index.ts";

const app = new Hono();

initializeDatabase(db);
seedDatabase(db);

// event bus, subscribers
initializeApplication();

startAggregatorWorker();

setInterval(async () => {
  checkAndReassignTimeouts();
}, 60 * 1000);

// Global middleware
app.use("/*", securityHeaders);
app.use(
  "/*",
  cors({
    origin: getFrontendUrl(),
    credentials: true,
  }),
);

app.use(
  "/media/*",
  serveStatic({
    root: "./data/uploads",
    rewriteRequestPath: (p) => p.replace(/^\/media/, ""),
  }),
);

// Unprotected routes
app.get("/health", async (c) => {
  const providers = getAllStatus();
  const notifier = await checkNotifierHealth();

  const allHealthy =
    providers.fnb.available && providers.gaso.available && notifier;

  return c.json({
    status: allHealthy ? "healthy" : "degraded",
    providers,
    notifier: {
      status: notifier ? "healthy" : "unavailable",
    },
    timestamp: new Date().toISOString(),
  });
});

app.route("/api/webhook", webhook);

// Auth routes
app.post("/api/auth/login", rateLimiter, async (c) => {
  const { username, password } = await c.req.json();

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as
    | {
        id: string;
        username: string;
        password_hash: string;
        role: string;
        name: string;
        is_active: number;
      }
    | undefined;

  if (!user || user.is_active === 0) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const token = generateSessionToken();
  const session = createSession(token, user.id);
  setSessionTokenCookie(c, token, session.expiresAt);

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
    },
  });
});

app.post("/api/auth/logout", requireAuth, async (c) => {
  const session = c.get("session");
  invalidateSession(session.id);
  deleteSessionTokenCookie(c);
  return c.json({ success: true });
});

app.get("/api/auth/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({ user });
});

app.patch("/api/auth/availability", requireAuth, async (c) => {
  const user = c.get("user");
  const { isAvailable } = await c.req.json();

  if (typeof isAvailable !== "boolean") {
    return c.json({ error: "isAvailable must be boolean" }, 400);
  }

  db.prepare("UPDATE users SET is_available = ? WHERE id = ?").run(
    isAvailable ? 1 : 0,
    user.id,
  );

  return c.json({ success: true, isAvailable });
});

// Protected routes
app.use("/api/*", requireAuth);
app.route("/api/simulator", simulator);
app.route("/api/conversations", conversations);
app.route("/api/catalog", catalog);
app.route("/api/periods", periods);
app.route("/api/orders", orders);

// Analytics routes
const requireAnalyticsAccess = requireRole("admin", "developer", "supervisor");
app.use("/api/analytics/*", requireAnalyticsAccess);
app.route("/api/analytics", analytics);

// System logs routes
app.use("/api/system/logs/*", requireAnalyticsAccess);
app.route("/api/system/logs", systemLogs);

// Admin-only routes
app.use("/api/admin/*", requireRole("admin"));
app.route("/api/admin", admin);

// Reports
const requireReportsAccess = requireRole("admin", "developer", "supervisor");

app.get("/api/reports/daily", requireReportsAccess, (c) => {
  const dateStr = c.req.query("date");
  const date = dateStr ? new Date(dateStr) : new Date();
  const buffer = ReportService.generateDailyReport(date);

  c.header(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  c.header(
    "Content-Disposition",
    `attachment; filename="report-${date.toISOString().split("T")[0]}.xlsx"`,
  );

  return c.body(buffer);
});

app.get("/api/reports/today-count", requireReportsAccess, (c) => {
  const count = ReportService.getTodayContactCount();
  return c.json({ count });
});

app.get("/api/reports/activity", requireReportsAccess, (c) => {
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const segmentsStr = c.req.query("segments") || "fnb,gaso,none";
  const saleStatusesStr = c.req.query("saleStatuses") || "all";

  // Parse dates
  const startDate = startDateStr ? new Date(startDateStr) : new Date();
  startDate.setHours(0, 0, 0, 0);

  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  endDate.setHours(23, 59, 59, 999);

  // Parse arrays
  const segments = segmentsStr.split(",").filter(Boolean);
  const saleStatuses = saleStatusesStr.split(",").filter(Boolean);

  const buffer = ReportService.generateActivityReport({
    startDate,
    endDate,
    segments,
    saleStatuses,
  });

  const filename = `reporte-actividad-${startDate.toISOString().split("T")[0]}-a-${endDate.toISOString().split("T")[0]}.xlsx`;

  c.header(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  c.header("Content-Disposition", `attachment; filename="${filename}"`);

  return c.body(buffer);
});

app.get("/api/reports/orders", requireReportsAccess, (c) => {
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");
  const status = c.req.query("status") || "";
  const assignedAgent = c.req.query("assignedAgent") || "";

  const startDate = startDateStr ? new Date(startDateStr) : undefined;
  const endDate = endDateStr ? new Date(endDateStr) : undefined;

  const buffer = ReportService.generateOrderReport({
    startDate,
    endDate,
    status: status || undefined,
    assignedAgent: assignedAgent || undefined,
  });

  const dateRange = startDate
    ? `${startDate.toISOString().split("T")[0]}-a-${endDate ? endDate.toISOString().split("T")[0] : "hoy"}`
    : "todas";
  const filename = `reporte-ordenes-${dateRange}.xlsx`;

  c.header(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  c.header("Content-Disposition", `attachment; filename="${filename}"`);

  return c.body(buffer);
});

// Provider check endpoint
app.get("/api/providers/:dni", requireAuth, async (c) => {
  const dni = c.req.param("dni");

  if (!/^\d{8}$/.test(dni)) {
    return c.json({ error: "DNI debe tener 8 dígitos" }, 400);
  }

  try {
    const handler = new CheckEligibilityHandler();
    const result = await handler.execute(dni);
    const healthStatus = getAllStatus();

    let displayResult: any = result;
    if (isOk(result)) {
      displayResult = result.value;
    } else {
      displayResult = {
        error: result.error.message,
        details: result.error,
      };
    }

    return c.json({
      dni,
      result: displayResult,
      providersChecked: [
        ...(healthStatus.fnb.available ? ["fnb"] : []),
        ...(healthStatus.gaso.available ? ["gaso"] : []),
      ],
    });
  } catch (error) {
    return c.json({ error: "Error al consultar proveedor" }, 500);
  }
});

// Error handler
app.onError(errorHandler);

const port = 3000;

process.on("SIGINT", async () => {
  logger.info("Shutting down (SIGINT)");
  await stopAggregatorWorker();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down (SIGTERM)");
  await stopAggregatorWorker();
  process.exit(0);
});

export default { port, fetch: app.fetch };

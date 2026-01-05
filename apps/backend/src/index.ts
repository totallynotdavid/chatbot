import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
// import { getCookie } from "hono/cookie";
import process from "node:process";

import { db } from "./db/index.ts";
import { initializeDatabase } from "./db/init.ts";
import { seedDatabase } from "./db/seed.ts";
import bcrypt from "bcryptjs";

import {
  generateSessionToken,
  createSession,
  validateSessionToken,
  invalidateSession,
  setSessionTokenCookie,
  deleteSessionTokenCookie,
} from "./services/auth.ts";

import { requireAuth, requireRole } from "./middleware/auth.ts";
import { errorHandler } from "./middleware/error.ts";
import { securityHeaders, rateLimiter } from "./middleware/security.ts";

import webhook from "./routes/webhook.ts";
import simulator from "./routes/simulator.ts";
import conversations from "./routes/conversations.ts";
import analytics from "./routes/analytics.ts";
import admin from "./routes/admin.ts";
import catalog from "./routes/catalog.ts";

import { getProvidersHealth } from "./services/providers.ts";
import { ReportService } from "./services/reports.ts";
import { checkNotifierHealth } from "./services/notifier.ts";

const app = new Hono();

// Initialize database schema and seed data on startup
initializeDatabase(db);
seedDatabase(db);

// Global middleware
app.use("/*", securityHeaders);
app.use(
  "/*",
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);

// Serve static files
app.use(
  "/static/*",
  serveStatic({
    root: "./data/uploads",
    rewriteRequestPath: (p) => p.replace(/^\/static/, ""),
  }),
);

// Public routes
app.get("/health", async (c) => {
  const providers = getProvidersHealth();
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

// Auth routes
app.post("/api/auth/login", rateLimiter, async (c) => {
  const { username, password } = await c.req.json();

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as any;

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

// Protected routes
app.route("/webhook", webhook);

app.use("/api/*", requireAuth);
app.route("/api/simulator", simulator);
app.route("/api/conversations", conversations);
app.route("/api/analytics", analytics);
app.route("/api/catalog", catalog);

// Admin-only routes
app.use("/api/admin/*", requireRole("admin"));
app.route("/api/admin", admin);

// Reports
app.get("/api/reports/daily", requireAuth, (c) => {
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

app.get("/api/reports/today-count", requireAuth, (c) => {
  const count = ReportService.getTodayContactCount();
  return c.json({ count });
});

app.get("/api/reports/activity", requireAuth, (c) => {
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

// Provider check endpoint
app.get("/api/providers/:dni", requireAuth, async (c) => {
  const dni = c.req.param("dni");

  if (!/^\d{8}$/.test(dni)) {
    return c.json({ error: "DNI debe tener 8 dígitos" }, 400);
  }

  const { FNBProvider, GasoProvider } = await import("./services/providers.ts");
  const healthStatus = getProvidersHealth();

  try {
    let fnbResult = null;
    if (healthStatus.fnb.available) {
      fnbResult = await FNBProvider.checkCredit(dni);
      if (fnbResult.eligible) {
        return c.json({
          provider: "fnb",
          dni,
          result: fnbResult,
          providersChecked: ["fnb"],
        });
      }
    }

    let gasoResult = null;
    if (healthStatus.gaso.available) {
      gasoResult = await GasoProvider.checkEligibility(dni);
      if (gasoResult.eligible || gasoResult.reason !== "not_found") {
        const checked = healthStatus.fnb.available ? ["fnb", "gaso"] : ["gaso"];
        return c.json({
          provider: "gaso",
          dni,
          result: gasoResult,
          providersChecked: checked,
        });
      }
    }

    const checked: string[] = [];
    if (healthStatus.fnb.available) checked.push("fnb");
    if (healthStatus.gaso.available) checked.push("gaso");

    return c.json({
      provider: null,
      dni,
      result: { eligible: false, credit: 0, reason: "not_found" },
      providersChecked: checked,
      providersUnavailable: !(
        healthStatus.fnb.available && healthStatus.gaso.available
      )
        ? {
            fnb: !healthStatus.fnb.available,
            gaso: !healthStatus.gaso.available,
          }
        : undefined,
    });
  } catch (_error) {
    return c.json({ error: "Error al consultar proveedor" }, 500);
  }
});

// Error handler
app.onError(errorHandler);

const port = parseInt(process.env.PORT || "3000", 10);

export default { port, fetch: app.fetch };

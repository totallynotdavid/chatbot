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
import { purgeProcessedMessages } from "./conversation/processed-retention.ts";

const logger = createLogger("app");

import { db } from "./db/index.ts";
import { initializeDatabase } from "./db/init.ts";
import { seedDatabase } from "./db/seed.ts";
import { accountsOn } from "./domains/accounts/index.ts";

import { requireAuth, requireRole } from "./middleware/auth.ts";
import { errorHandler } from "./middleware/error.ts";
import { securityHeaders } from "./middleware/security.ts";

import webhook from "./routes/webhook.ts";
import auth from "./routes/auth.ts";
import simulator from "./routes/simulator.ts";
import conversations from "./routes/conversations.ts";
import analytics from "./routes/analytics.ts";
import reports from "./routes/reports.ts";
import admin from "./routes/admin.ts";
import catalog from "./routes/catalog.ts";
import periods from "./routes/periods.ts";
import orders from "./routes/orders.ts";
import systemLogs from "./routes/system-logs.ts";
import tenants from "./routes/tenants.ts";
import assets from "./routes/assets.ts";
import providerRoutes from "./routes/providers.ts";

import { getAllStatus } from "./adapters/providers/health.ts";
import { checkNotifierHealth } from "./adapters/notifier/client.ts";
import { checkAndReassignTimeouts } from "./domains/conversations/assignment.ts";
import { initializeApplication } from "./bootstrap/index.ts";
import { IMAGES_DIR } from "./lib/storage-paths.ts";

const app = new Hono();

// Awaited so a seed that throws stops the boot before Bun binds the port.
initializeDatabase(db);
await seedDatabase(db);

if (!accountsOn(db).hasPlatformOperator()) {
  logger.warn(
    "No platform operator can log in, so nobody can create a tenant or act " +
      "across tenants. Run `bun run account create <username> " +
      "--platform-operator`, or `bun run account promote <username>` for an " +
      "existing account.",
  );
}

if (!process.env.WHATSAPP_APP_SECRET) {
  logger.warn(
    "WHATSAPP_APP_SECRET is not set, so POST /api/webhook answers 503 and no " +
      "inbound message is accepted. Set it to the Meta app secret.",
  );
}

// event bus, subscribers
initializeApplication();

startAggregatorWorker();

setInterval(async () => {
  checkAndReassignTimeouts();
}, 60 * 1000);

setInterval(
  () => {
    purgeProcessedMessages();
  },
  60 * 60 * 1000,
);

// Global middleware
app.use("/*", securityHeaders);
app.use(
  "/*",
  cors({
    origin: getFrontendUrl(),
    credentials: true,
  }),
);

// Only catalog images are served statically, because Meta fetches the image
// link with no credentials. Contracts and call recordings live outside this
// directory and are reachable only through /api/assets/:id, which checks
// tenant scope.
app.use(
  "/media/images/*",
  serveStatic({
    // The root derives from UPLOAD_DIR, like the store's write path. A relative
    // literal would resolve against the working directory, where the store does
    // not write.
    root: IMAGES_DIR,
    rewriteRequestPath: (p) => p.replace(/^\/media\/images/, ""),
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

app.route("/api/auth", auth);

// Protected routes
app.use("/api/*", requireAuth);
app.route("/api/tenants", tenants);
app.route("/api/assets", assets);
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
app.route("/api/reports", reports);

app.route("/api/providers", providerRoutes);

// Error handler
app.onError(errorHandler);

// PORT lets a second instance, or a test that boots the real server, listen
// somewhere other than the development default.
const port = Number(process.env.PORT) || 3000;

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

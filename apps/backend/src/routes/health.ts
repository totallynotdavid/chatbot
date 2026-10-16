import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getAllStatus } from "../adapters/providers/health.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("health");

function databaseUp(db: Database): boolean {
  try {
    db.query("SELECT 1").get();
    return true;
  } catch (error) {
    logger.error({ error }, "Health check could not reach the database");
    return false;
  }
}

/**
 * Answers 503 when the database does not answer a query. Container healthchecks
 * and deploy gates use that status code. Provider trouble leaves the code at
 * 200 and appears in `status`.
 */
export function healthRoute(db: Database): Hono {
  const health = new Hono();

  health.get("/", (c) => {
    const database = databaseUp(db);
    const providers = getAllStatus();
    const healthy =
      database && providers.fnb.available && providers.gaso.available;

    return c.json(
      {
        status: !database ? "unavailable" : healthy ? "healthy" : "degraded",
        database: { status: database ? "healthy" : "unavailable" },
        providers,
        timestamp: new Date().toISOString(),
      },
      database ? 200 : 503,
    );
  });

  return health;
}

import type { Context } from "hono";
import process from "node:process";
import { createLogger } from "../lib/logger.ts";
import { InvalidDateError } from "../db/query.ts";
import { TenantScopeRequiredError } from "../platform/auth/scope.ts";
import { NO_ACTIVE_TENANT } from "./auth.ts";

const logger = createLogger("app");

export async function errorHandler(err: Error, c: Context) {
  // A write reached a handler with no tenant to land in, which means the route
  // is missing `requireActiveTenant`. Refusing it is the point of the
  // invariant; a 500 would hide it.
  if (err instanceof TenantScopeRequiredError) {
    logger.error(
      { path: c.req.path, method: c.req.method },
      "Route asked for the active tenant without requiring one",
    );
    return c.json(NO_ACTIVE_TENANT, 403);
  }

  if (err instanceof InvalidDateError) {
    return c.json({ error: err.message }, 400);
  }

  logger.error(
    { err, path: c.req.path, method: c.req.method },
    "Unhandled error",
  );

  const isDev = process.env.NODE_ENV !== "production";

  return c.json(
    {
      error: "Internal server error",
      message: isDev ? err.message : undefined,
      stack: isDev ? err.stack : undefined,
    },
    500,
  );
}

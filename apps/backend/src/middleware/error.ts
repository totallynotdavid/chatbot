import type { Context } from "hono";
import process from "node:process";
import { InvalidPagingError } from "../lib/http.ts";
import { createLogger } from "../lib/logger.ts";
import { InvalidDateError } from "../db/query.ts";
import { TenantScopeRequiredError } from "../platform/auth/scope.ts";
import { NO_ACTIVE_TENANT } from "./auth.ts";

const logger = createLogger("app");

export async function errorHandler(err: Error, c: Context) {
  // A handler asked for the active tenant while none was pinned, so its route
  // is missing `requireActiveTenant`. Refusing it is the point of the invariant.
  // A 500 would hide the missing guard.
  if (err instanceof TenantScopeRequiredError) {
    logger.error(
      { path: c.req.path, method: c.req.method },
      "Route asked for the active tenant without requiring one",
    );
    return c.json(NO_ACTIVE_TENANT, 403);
  }

  if (err instanceof InvalidDateError || err instanceof InvalidPagingError) {
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

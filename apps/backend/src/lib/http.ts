import type { Context } from "hono";

/**
 * Hono types `c.req.param()` as possibly undefined when a route lists
 * middleware before its handler, even for a segment the pattern requires. This
 * throws when a route is registered without the segment it reads.
 */
export function pathParam(c: Context, name: string): string {
  const value = c.req.param(name);

  if (value === undefined) {
    throw new Error(`Route is missing the :${name} path parameter`);
  }

  return value;
}

export const MAX_LIMIT = 500;

const PLAIN_INTEGER = /^\d+$/;

/**
 * A `limit` or `offset` query value outside its range, or not a plain decimal
 * integer. `middleware/error.ts` answers it as 400.
 */
export class InvalidPagingError extends Error {
  constructor(
    readonly field: "limit" | "offset",
    range: string,
  ) {
    super(`${field} must be ${range}`);
  }
}

/** The `limit` query value, or `fallback` when it is absent or empty. */
export function queryLimit(c: Context, fallback: number): number {
  const raw = c.req.query("limit");
  if (raw === undefined || raw === "") return fallback;

  const value = PLAIN_INTEGER.test(raw) ? Number(raw) : Number.NaN;
  if (!(value >= 1 && value <= MAX_LIMIT)) {
    throw new InvalidPagingError(
      "limit",
      `a whole number from 1 to ${MAX_LIMIT}`,
    );
  }

  return value;
}

/** The `offset` query value, or 0 when it is absent or empty. */
export function queryOffset(c: Context): number {
  const raw = c.req.query("offset");
  if (raw === undefined || raw === "") return 0;

  const value = PLAIN_INTEGER.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new InvalidPagingError("offset", "a whole number of 0 or more");
  }

  return value;
}

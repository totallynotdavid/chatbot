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

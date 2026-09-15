import type { Context } from "hono";

/**
 * A path parameter that the route pattern guarantees exists.
 *
 * Hono types `c.req.param()` as possibly-undefined once a handler sits behind
 * middleware, even for a segment the pattern requires. This keeps that noise out
 * of the handlers while still failing loudly if a route is ever registered
 * without the segment it reads.
 */
export function pathParam(c: Context, name: string): string {
  const value = c.req.param(name);

  if (value === undefined) {
    throw new Error(`Route is missing the :${name} path parameter`);
  }

  return value;
}

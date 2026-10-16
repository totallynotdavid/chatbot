import type { RequestHandler } from "./$types";

/** The container healthcheck reads this response. */
export const GET: RequestHandler = () => new Response("ok");

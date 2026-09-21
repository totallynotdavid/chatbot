import type { RequestHandler } from "./$types";
import { getBackendUrl } from "@vendeya/utils";

const backendUrl = getBackendUrl();

/**
 * Forwards /api/* to the backend at the same path. The body goes as bytes: an
 * upload is binary multipart, and decoding it as text would replace every
 * byte that is not valid UTF-8.
 */
async function proxyRequest(
  method: string,
  pathname: string,
  query: string,
  request: Request,
): Promise<Response> {
  const url = `${backendUrl}${pathname}${query}`;

  try {
    const body =
      request.method !== "GET" && request.method !== "HEAD"
        ? await request.arrayBuffer()
        : undefined;

    const response = await fetch(url, {
      method,
      headers: {
        ...Object.fromEntries(request.headers),
        "x-forwarded-for": request.headers.get("x-forwarded-for") || "unknown",
        "x-forwarded-proto": "https",
      },
      ...(body?.byteLength && { body }),
    });

    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    console.error(`[proxy] ${method} ${pathname} failed:`, error);
    return new Response(JSON.stringify({ error: "Service unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

export const GET: RequestHandler = async ({ url, request }) => {
  return proxyRequest("GET", url.pathname, url.search, request);
};

export const POST: RequestHandler = async ({ url, request }) => {
  return proxyRequest("POST", url.pathname, url.search, request);
};

export const PATCH: RequestHandler = async ({ url, request }) => {
  return proxyRequest("PATCH", url.pathname, url.search, request);
};

export const DELETE: RequestHandler = async ({ url, request }) => {
  return proxyRequest("DELETE", url.pathname, url.search, request);
};

export const PUT: RequestHandler = async ({ url, request }) => {
  return proxyRequest("PUT", url.pathname, url.search, request);
};

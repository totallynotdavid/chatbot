import type { RequestHandler } from "./$types";
import { getBackendUrl } from "@vendeya/utils";

const backendUrl = getBackendUrl();
const BACKEND_TIMEOUT_MS = 10_000;
// Meta documents webhook payloads of up to 3 MB. The backend holds the same
// bound.
const MAX_BODY_BYTES = 3 * 1024 * 1024;

/**
 * Webhook proxy for Meta WhatsApp events
 * GET: Hub verification challenge
 * POST: Incoming messages, answered with what the backend made of them
 */
export const GET: RequestHandler = async ({ url }) => {
  try {
    const response = await fetch(`${backendUrl}/api/webhook${url.search}`, {
      method: "GET",
    });
    return new Response(await response.text(), { status: response.status });
  } catch (error) {
    console.error("[webhook] GET failed:", error);
    return new Response("Service unavailable", { status: 503 });
  }
};

/**
 * The body as text, or null once it passes `MAX_BODY_BYTES`. The server accepts
 * bodies far larger than a webhook for the dashboard's uploads, so this route
 * bounds its own read, and stops pulling from a chunked body at the limit.
 */
async function readBoundedText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request.body) {
    total += chunk.byteLength;
    if (total > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf-8");
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await readBoundedText(request);
    if (body === null) {
      return new Response(JSON.stringify({ error: "payload_too_large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }

    // The backend verifies Meta's signature over this exact body.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const signature = request.headers.get("x-hub-signature-256");
    if (signature) headers["X-Hub-Signature-256"] = signature;

    // Meta gets the backend's verdict: 2xx acknowledges, anything else is
    // relayed so Meta retries it.
    let response: Response;
    try {
      response = await fetch(`${backendUrl}/api/webhook`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      });
    } catch (err) {
      console.error("[webhook] POST failed:", err);
      return new Response(JSON.stringify({ status: "error" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!response.ok) {
      return new Response(await response.text(), {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("Content-Type") ?? "application/json",
        },
      });
    }

    return new Response(JSON.stringify({ status: "received" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[webhook] handler failed:", error);
    return new Response(JSON.stringify({ status: "error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

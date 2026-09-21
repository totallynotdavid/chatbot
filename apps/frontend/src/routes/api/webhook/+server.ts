import type { RequestHandler } from "./$types";
import { getBackendUrl } from "@vendeya/utils";

const backendUrl = getBackendUrl();
const BACKEND_TIMEOUT_MS = 10_000;

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

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.text();

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

import type { RequestHandler } from "./$types";
import { getBackendUrl } from "@totem/utils";

const backendUrl = getBackendUrl();

/**
 * Webhook proxy for Meta WhatsApp events
 * GET: Hub verification challenge
 * POST: Incoming messages (fire-and-forget)
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

    // Fire-and-forget: don't wait for backend
    fetch(`${backendUrl}/api/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch((err) => console.error("[webhook] POST failed:", err));

    // Return 200 immediately to Meta
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

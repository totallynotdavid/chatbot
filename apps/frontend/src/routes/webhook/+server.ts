import type { RequestHandler } from "./$types";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

/**
 * GET /webhook (Meta webhook verification)
 * Forwards verification challenge from Meta to backend
 */
export const GET: RequestHandler = async ({ url }) => {
  try {
    const params = url.searchParams.toString();
    const response = await fetch(`${BACKEND_URL}/webhook?${params}`, {
      method: "GET",
    });

    const text = await response.text();
    return new Response(text, { status: response.status });
  } catch (error) {
    console.error("[webhook] GET forward failed:", error);
    return new Response("Service unavailable", { status: 503 });
  }
};

/**
 * POST /webhook (WhatsApp message webhook)
 * Forwards incoming messages to backend and returns 200 immediately to Meta
 * Backend processes message asynchronously
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.text();

    // Fire and forget
    fetch(`${BACKEND_URL}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    }).catch((err) => {
      console.error("[webhook] POST forward failed:", err);
    });

    // Return 200 immediately to Meta
    return new Response(JSON.stringify({ status: "received" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("[webhook] POST handler failed:", error);
    return new Response(JSON.stringify({ status: "error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
};

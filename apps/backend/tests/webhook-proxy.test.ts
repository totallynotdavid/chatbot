/**
 * The frontend's Meta webhook proxy answers Meta with what the backend made of
 * the delivery, so a delivery the backend refused is one Meta retries.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import process from "node:process";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";
import { signWebhookBody, TEST_APP_SECRET } from "./helpers/webhook.ts";

import webhook from "../src/routes/webhook.ts";

// Loaded by a computed path: the SvelteKit file is outside this project's tsc
// rootDir and imports generated ./$types.
const PROXY_PATH = "../../frontend/src/routes/api/webhook/+server.ts";
const { POST } = (await import(PROXY_PATH)) as {
  POST: (event: { request: Request }) => Promise<Response>;
};

const BACKEND_WEBHOOK_URL = "http://localhost:3000/api/webhook";
const realFetch = globalThis.fetch;
const realTimeout = AbortSignal.timeout;
const realConsoleError = console.error;

describe("webhook proxy", () => {
  let tenant: TenantFixture;
  let messageId: string;
  let rawBody: string;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("proxy");
    messageId = `wamid-${crypto.randomUUID()}`;
    rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-proxy",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: tenant.phoneNumberId },
                messages: [
                  {
                    from: "51900999000",
                    id: messageId,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "hola" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    console.error = () => {};
    routeBackendCallsTo(webhook.request.bind(webhook));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    AbortSignal.timeout = realTimeout;
    console.error = realConsoleError;
    process.env.WHATSAPP_APP_SECRET = TEST_APP_SECRET;
    dropTenantFixture(tenant);
  });

  /** Sends the proxy's calls for the backend webhook to `handle`. */
  function routeBackendCallsTo(
    handle: (path: string, init?: RequestInit) => Response | Promise<Response>,
  ) {
    globalThis.fetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      if (String(input) !== BACKEND_WEBHOOK_URL) return realFetch(input, init);
      return handle("/", init);
    }) as typeof fetch;
  }

  function deliver(signature: string | undefined) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (signature !== undefined) headers["X-Hub-Signature-256"] = signature;

    return POST({
      request: new Request("http://localhost:5173/api/webhook", {
        method: "POST",
        headers,
        body: rawBody,
      }),
    });
  }

  function inboxRows(): number {
    return (
      db
        .prepare("SELECT COUNT(*) as c FROM message_inbox WHERE message_id = ?")
        .get(messageId) as { c: number }
    ).c;
  }

  it("answers 200 for a valid signature and the message reaches the inbox", async () => {
    const response = await deliver(signWebhookBody(rawBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "received" });
    expect(inboxRows()).toBe(1);
  });

  it("relays a 401 for a signature made with another secret", async () => {
    const response = await deliver(signWebhookBody(rawBody, "someone-else"));

    expect(response.status).toBe(401);
    expect(inboxRows()).toBe(0);
  });

  it("relays a 401 for an unsigned request", async () => {
    const response = await deliver(undefined);

    expect(response.status).toBe(401);
    expect(inboxRows()).toBe(0);
  });

  it("relays a 503 when the backend has no app secret", async () => {
    delete process.env.WHATSAPP_APP_SECRET;

    const response = await deliver(signWebhookBody(rawBody));

    expect(response.status).toBe(503);
    expect(inboxRows()).toBe(0);
  });

  it("answers 503 when the backend cannot be reached", async () => {
    routeBackendCallsTo(() => Promise.reject(new TypeError("fetch failed")));

    const response = await deliver(signWebhookBody(rawBody));

    expect(response.status).toBe(503);
    expect(inboxRows()).toBe(0);
  });

  it("answers 503 when the backend outlasts the timeout", async () => {
    const requested: number[] = [];
    AbortSignal.timeout = (ms: number) => {
      requested.push(ms);
      return realTimeout(20);
    };
    routeBackendCallsTo(
      (_path, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );

    const response = await deliver(signWebhookBody(rawBody));

    expect(response.status).toBe(503);
    expect(requested).toEqual([10_000]);
    expect(inboxRows()).toBe(0);
  });
});

/**
 * POST /api/webhook is public, so it refuses a body over 3 MiB before it
 * reads the rest of it, checks a signature or parses anything. Meta documents
 * payloads of up to 3 MB.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";
import { chunkedSpaces, signWebhookBody } from "./helpers/webhook.ts";

import webhook from "../src/routes/webhook.ts";

const LIMIT_BYTES = 3 * 1024 * 1024;

describe("webhook body limit", () => {
  let tenant: TenantFixture;
  let messageId: string;
  let rawBody: string;

  beforeEach(() => {
    applySchema();
    tenant = createTenantFixture("body-limit");
    messageId = `wamid-${crypto.randomUUID()}`;
    rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-body-limit",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: tenant.phoneNumberId },
                messages: [
                  {
                    from: "51900555666",
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
  });

  afterEach(() => {
    dropTenantFixture(tenant);
  });

  /** `rawBody` followed by spaces, which JSON.parse ignores, up to `bytes`. */
  function paddedTo(bytes: number): string {
    const padded = rawBody + " ".repeat(bytes - Buffer.byteLength(rawBody));
    expect(Buffer.byteLength(padded)).toBe(bytes);
    return padded;
  }

  function post(
    body: string | ReadableStream<Uint8Array>,
    signature: string | undefined,
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (signature !== undefined) headers["X-Hub-Signature-256"] = signature;
    return webhook.request("/", {
      method: "POST",
      headers,
      body,
      duplex: "half",
    } as RequestInit);
  }

  function inboxRows(): number {
    return (
      db
        .prepare("SELECT COUNT(*) as c FROM message_inbox WHERE message_id = ?")
        .get(messageId) as { c: number }
    ).c;
  }

  it("refuses a body one byte over the limit, though it is signed", async () => {
    const body = paddedTo(LIMIT_BYTES + 1);

    const response = await post(body, signWebhookBody(body));

    expect(response.status).toBe(413);
    expect(inboxRows()).toBe(0);
  });

  it("takes a body of exactly the limit to the signature check", async () => {
    const body = paddedTo(LIMIT_BYTES);

    const unsigned = await post(body, undefined);
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ error: "invalid_signature" });
    expect(inboxRows()).toBe(0);

    const signed = await post(body, signWebhookBody(body));
    expect(signed.status).toBe(200);
    expect(inboxRows()).toBe(1);
  });

  it("stops reading a chunked body that passes the limit", async () => {
    const source = chunkedSpaces(LIMIT_BYTES + 20 * 64 * 1024);

    const response = await post(source.stream, signWebhookBody(rawBody));

    expect(response.status).toBe(413);
    // The stream keeps one chunk ready ahead of the reader, so the reader is
    // at most a chunk past the limit when it stops.
    expect(source.pulledBytes()).toBeLessThanOrEqual(
      LIMIT_BYTES + 2 * source.chunkBytes,
    );
    expect(inboxRows()).toBe(0);
  });

  it("processes a chunked body under the limit", async () => {
    const bytes = new TextEncoder().encode(rawBody);
    const half = Math.floor(bytes.length / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, half));
        controller.enqueue(bytes.slice(half));
        controller.close();
      },
    });

    const response = await post(stream, signWebhookBody(rawBody));

    expect(response.status).toBe(200);
    expect(inboxRows()).toBe(1);
  });
});

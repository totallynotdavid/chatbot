/**
 * The dashboard's `/api` proxy forwards a request body to the backend byte for
 * byte. Uploads (bundle images, contract PDFs, call recordings) are binary
 * multipart bodies, and the backend stores what it receives.
 */

import { describe, it, expect, afterEach } from "bun:test";

// Loaded by a computed path: the SvelteKit file is outside this project's tsc
// rootDir and imports generated ./$types.
const PROXY_PATH = "../../frontend/src/routes/api/[...path]/+server.ts";
const proxy = (await import(PROXY_PATH)) as Record<
  "GET" | "POST" | "PATCH",
  (event: { url: URL; request: Request }) => Promise<Response>
>;

const BACKEND = "http://localhost:3000";
const realFetch = globalThis.fetch;

type Forwarded = { url: string; init: RequestInit };

/** Replaces the global fetch with one that records the proxy's call. */
function captureBackendCalls(): Forwarded[] {
  const calls: Forwarded[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

/** The bytes a `fetch` init would put on the wire, whatever type carries them. */
async function wireBytes(body: RequestInit["body"]): Promise<Uint8Array> {
  if (body === undefined || body === null) return new Uint8Array();
  return new Uint8Array(
    await new Response(
      body as ConstructorParameters<typeof Response>[0],
    ).arrayBuffer(),
  );
}

function call(method: "GET" | "POST" | "PATCH", request: Request) {
  return proxy[method]({ url: new URL(request.url), request });
}

describe("the dashboard API proxy", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("forwards a binary multipart upload unchanged", async () => {
    const calls = captureBackendCalls();
    // Every byte value, so a UTF-8 round trip cannot leave the bytes alone:
    // 0x80-0xFF are not valid UTF-8 on their own.
    const image = new Uint8Array(4096).map((_, i) => i % 256);
    const form = new FormData();
    form.append(
      "image",
      new File([image], "bundle.jpg", { type: "image/jpeg" }),
    );
    const request = new Request(
      "http://dashboard.test/api/catalog/bundles/b1/image",
      {
        method: "POST",
        body: form,
      },
    );
    const sent = new Uint8Array(await request.clone().arrayBuffer());

    const response = await call("POST", request);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BACKEND}/api/catalog/bundles/b1/image`);
    const forwarded = await wireBytes(calls[0]!.init.body);
    expect(forwarded.byteLength).toBe(sent.byteLength);
    expect(Buffer.from(forwarded).equals(Buffer.from(sent))).toBe(true);
  });

  it("keeps the content type, whose boundary the body depends on", async () => {
    const calls = captureBackendCalls();
    const form = new FormData();
    form.append("image", new File([new Uint8Array([0xff, 0xd8])], "a.jpg"));
    const request = new Request("http://dashboard.test/api/catalog/bundles", {
      method: "POST",
      body: form,
    });

    await call("POST", request);

    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("content-type")).toBe(
      request.headers.get("content-type"),
    );
  });

  it("forwards a JSON body and the query string", async () => {
    const calls = captureBackendCalls();
    const request = new Request(
      "http://dashboard.test/api/catalog/bundles/b1?x=1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Cocina ñandú" }),
      },
    );

    await call("PATCH", request);

    expect(calls[0]!.url).toBe(`${BACKEND}/api/catalog/bundles/b1?x=1`);
    const forwarded = new TextDecoder().decode(
      await wireBytes(calls[0]!.init.body),
    );
    expect(JSON.parse(forwarded)).toEqual({ name: "Cocina ñandú" });
  });

  it("sends no body for a GET", async () => {
    const calls = captureBackendCalls();
    const request = new Request("http://dashboard.test/api/orders");

    await call("GET", request);

    expect(calls[0]!.url).toBe(`${BACKEND}/api/orders`);
    expect(calls[0]!.init.body).toBeUndefined();
  });
});

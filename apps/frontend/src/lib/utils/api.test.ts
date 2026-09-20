/// <reference types="bun" />

import { describe, it, expect, afterEach } from "bun:test";
import { fetchApi } from "./api.ts";

const realFetch = globalThis.fetch;

describe("fetchApi", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("carries the HTTP status on the error it throws", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
      })) as unknown as typeof fetch;

    const error = (await fetchApi("/api/providers/12345678").catch(
      (e) => e,
    )) as Error & { status?: number };

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Forbidden");
    expect(error.status).toBe(403);
  });
});

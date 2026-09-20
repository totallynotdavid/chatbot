import { createHmac } from "node:crypto";

export const TEST_APP_SECRET = "test-meta-app-secret";

/** The `X-Hub-Signature-256` value Meta would send for this raw body. */
export function signWebhookBody(
  rawBody: string,
  secret = TEST_APP_SECRET,
): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/** Init for `webhook.request("/", ...)`: a JSON body carrying a valid signature. */
export function signedWebhookRequest(body: unknown): RequestInit {
  const rawBody = JSON.stringify(body);
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signWebhookBody(rawBody),
    },
    body: rawBody,
  };
}

/**
 * A body of `totalBytes` spaces that arrives in `chunkBytes` pieces with no
 * Content-Length. `pulledBytes()` reports how much the reader has taken so far.
 */
export function chunkedSpaces(totalBytes: number, chunkBytes = 64 * 1024) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - pulled);
      controller.enqueue(new Uint8Array(size).fill(0x20));
      pulled += size;
    },
  });
  return { stream, pulledBytes: () => pulled, chunkBytes };
}

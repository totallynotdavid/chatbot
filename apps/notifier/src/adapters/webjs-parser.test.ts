import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "whatsapp-web.js";

// The notifier logger opens its log file when it is imported.
const dataDir = mkdtempSync(join(tmpdir(), "vendeya-notifier-parser-"));
process.env.NOTIFIER_DATA_PATH = dataDir;
const { parseIncomingMessage } = await import("./webjs-parser.ts");

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// whatsapp-web.js documents `Message.timestamp` as a Unix timestamp and shows
// `timestamp: 1591482682` in its own example: seconds.
const SECONDS = 1749416383;

function webjsMessage(overrides: Record<string, unknown> = {}): Message {
  return {
    id: { _serialized: "false_51999999999@c.us_ABC" },
    from: "51999999999@c.us",
    body: "hola",
    type: "chat",
    timestamp: SECONDS,
    hasQuotedMsg: false,
    ...overrides,
  } as unknown as Message;
}

test("an inbound message's timestamp is in milliseconds", async () => {
  const parsed = await parseIncomingMessage(webjsMessage());

  expect(parsed.timestamp).toBe(SECONDS * 1000);
});

test("a quoted message's timestamp is in milliseconds", async () => {
  const parsed = await parseIncomingMessage(
    webjsMessage({
      hasQuotedMsg: true,
      getQuotedMessage: async () => ({
        id: { _serialized: "quoted-1" },
        body: "antes",
        type: "chat",
        timestamp: SECONDS - 60,
      }),
    }),
  );

  expect(parsed.quotedContext?.timestamp).toBe((SECONDS - 60) * 1000);
});

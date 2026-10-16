/**
 * A message that was answered stays recognised by its Meta id until the
 * retention passes. Meta redelivers a webhook it considers unacknowledged, and
 * `isQueued` is the only record of ids already taken in.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import webhook from "../src/routes/webhook.ts";
import { signedWebhookRequest } from "./helpers/webhook.ts";
import { isQueued } from "../src/conversation/message-inbox.ts";
import {
  PROCESSED_MESSAGE_RETENTION_MS,
  purgeProcessedMessages,
} from "../src/conversation/processed-retention.ts";

const CUSTOMER = "51900444555";

function inbound(phoneNumberId: string, messageId: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-retention",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "51900000000",
                phone_number_id: phoneNumberId,
              },
              messages: [
                {
                  from: CUSTOMER,
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
  };
}

async function deliver(phoneNumberId: string, messageId: string) {
  const response = await webhook.request(
    "/",
    signedWebhookRequest(inbound(phoneNumberId, messageId)),
  );
  const body = (await response.json()) as {
    results: Array<{ status: string }>;
  };
  return body.results.map((result) => result.status);
}

function inboxRows(messageId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) as c FROM message_inbox WHERE message_id = ?")
      .get(messageId) as { c: number }
  ).c;
}

describe("a message after it has been answered", () => {
  let alpha: TenantFixture;
  let messageId: string;

  beforeEach(() => {
    applySchema();
    alpha = createTenantFixture("alpha-retention");
    messageId = `wamid-${crypto.randomUUID()}`;
  });

  afterEach(() => {
    dropTenantFixture(alpha);
  });

  it("is still recognised when Meta delivers it again", async () => {
    expect(await deliver(alpha.phoneNumberId, messageId)).toEqual(["received"]);

    db.prepare(
      "UPDATE message_inbox SET status = 'processed', processed_at = ? WHERE message_id = ?",
    ).run(Date.now(), messageId);

    expect(await deliver(alpha.phoneNumberId, messageId)).toEqual([
      "duplicate",
    ]);
    expect(inboxRows(messageId)).toBe(1);
  });
});

describe("purging answered messages", () => {
  const NOW = Date.now();
  const EXPIRED = NOW - PROCESSED_MESSAGE_RETENTION_MS - 1;
  const RECENT = NOW - PROCESSED_MESSAGE_RETENTION_MS + 60_000;
  const LONG_AGO = NOW - 30 * PROCESSED_MESSAGE_RETENTION_MS;

  let alpha: TenantFixture;

  function queued(status: string, processedAt: number | null): string {
    const messageId = `wamid-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO message_inbox
         (tenant_id, channel_account_id, phone_number, message_text, message_id,
          whatsapp_timestamp, status, created_at, processed_at)
       VALUES (?, ?, ?, 'hola', ?, 1, ?, ?, ?)`,
    ).run(
      alpha.tenantId,
      alpha.channelAccountId,
      CUSTOMER,
      messageId,
      status,
      LONG_AGO,
      processedAt,
    );
    return messageId;
  }

  beforeEach(() => {
    applySchema();
    alpha = createTenantFixture("alpha-purge");
  });

  afterEach(() => {
    dropTenantFixture(alpha);
  });

  it("forgets ids answered longer ago than the retention", () => {
    const id = queued("processed", EXPIRED);

    expect(purgeProcessedMessages(NOW)).toBe(1);

    expect(isQueued(id)).toBe(false);
  });

  it("keeps ids answered within the retention", () => {
    const id = queued("processed", RECENT);

    expect(purgeProcessedMessages(NOW)).toBe(0);

    expect(isQueued(id)).toBe(true);
  });

  it("keeps messages that were never answered, however old", () => {
    const id = queued("pending", null);

    expect(purgeProcessedMessages(NOW)).toBe(0);

    expect(isQueued(id)).toBe(true);
  });
});

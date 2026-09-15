/**
 * A message answered out of maintenance hold stays recognised by its Meta id.
 *
 * `isQueued` and `isHeld` together are the only record of which message ids
 * this deployment has already taken in. Meta redelivers a webhook it considers
 * unacknowledged, so an id that has been answered must still be known when the
 * same message arrives again.
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
import {
  countHeldMessages,
  holdMessage,
  isHeld,
} from "../src/conversation/held-messages.ts";
import { isQueued } from "../src/conversation/message-inbox.ts";
import { processHeldMessages } from "../src/conversation/process-held.ts";
import {
  PROCESSED_MESSAGE_RETENTION_MS,
  purgeProcessedMessages,
} from "../src/conversation/processed-retention.ts";
import { TenantSettings } from "../src/domains/settings/system.ts";

const CUSTOMER = "51900444555";

function inbound(phoneNumberId: string, messageId: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-held",
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
  const response = await webhook.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inbound(phoneNumberId, messageId)),
  });
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

describe("a held message after it has been answered", () => {
  let alpha: TenantFixture;
  let messageId: string;

  beforeEach(() => {
    applySchema();
    alpha = createTenantFixture("alpha-held-dedup");
    messageId = `wamid-${crypto.randomUUID()}`;
  });

  afterEach(() => {
    dropTenantFixture(alpha);
  });

  it("is still recognised when Meta delivers it again", async () => {
    TenantSettings.set(alpha.tenantId, "maintenance_mode", "true");
    expect(await deliver(alpha.phoneNumberId, messageId)).toEqual([
      "maintenance_held",
    ]);

    TenantSettings.set(alpha.tenantId, "maintenance_mode", "false");
    const run = await processHeldMessages(alpha.tenantId);
    expect(run.messagesProcessed).toBe(1);

    expect(await deliver(alpha.phoneNumberId, messageId)).toEqual([
      "duplicate",
    ]);
    expect(inboxRows(messageId)).toBe(0);
  });

  it("is not held, or answered, a second time", async () => {
    holdMessage(alpha.ref(CUSTOMER), "hola", messageId, 1);
    await processHeldMessages(alpha.tenantId);

    expect(isHeld(messageId)).toBe(true);

    holdMessage(alpha.ref(CUSTOMER), "hola", messageId, 1);

    expect(countHeldMessages(alpha.tenantId)).toBe(0);
    expect((await processHeldMessages(alpha.tenantId)).messagesProcessed).toBe(
      0,
    );
  });
});

describe("purging answered messages", () => {
  const NOW = Date.now();
  const EXPIRED = NOW - PROCESSED_MESSAGE_RETENTION_MS - 1;
  const RECENT = NOW - PROCESSED_MESSAGE_RETENTION_MS + 60_000;
  const LONG_AGO = NOW - 30 * PROCESSED_MESSAGE_RETENTION_MS;

  let alpha: TenantFixture;

  function held(processedAt: number | null): string {
    const messageId = `wamid-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO held_messages
         (tenant_id, channel_account_id, phone_number, message_text, message_id,
          whatsapp_timestamp, created_at, processed_at)
       VALUES (?, ?, ?, 'hola', ?, 1, ?, ?)`,
    ).run(
      alpha.tenantId,
      alpha.channelAccountId,
      CUSTOMER,
      messageId,
      LONG_AGO,
      processedAt,
    );
    return messageId;
  }

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
    alpha = createTenantFixture("alpha-held-purge");
  });

  afterEach(() => {
    dropTenantFixture(alpha);
  });

  it("forgets held and queued ids answered longer ago than the retention", () => {
    const heldId = held(EXPIRED);
    const queuedId = queued("processed", EXPIRED);

    purgeProcessedMessages(NOW);

    expect(isHeld(heldId)).toBe(false);
    expect(isQueued(queuedId)).toBe(false);
  });

  it("keeps ids answered within the retention", () => {
    const heldId = held(RECENT);
    const queuedId = queued("processed", RECENT);

    purgeProcessedMessages(NOW);

    expect(isHeld(heldId)).toBe(true);
    expect(isQueued(queuedId)).toBe(true);
  });

  it("keeps messages that were never answered, however old", () => {
    const heldId = held(null);
    const queuedId = queued("pending", null);

    purgeProcessedMessages(NOW);

    expect(isHeld(heldId)).toBe(true);
    expect(isQueued(queuedId)).toBe(true);
    expect(countHeldMessages(alpha.tenantId)).toBe(1);
  });
});

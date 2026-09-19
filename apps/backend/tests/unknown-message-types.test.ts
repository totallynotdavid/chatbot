/** A Cloud API message type the parser does not know is ignored at the webhook like any non-text message. */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { db } from "../src/db/index.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";

import webhook from "../src/routes/webhook.ts";
import { parseIncomingMessage } from "../src/adapters/whatsapp/parsers/cloud-api-parser.ts";

const CUSTOMER = "51900444555";

function deliver(phoneNumberId: string, message: Record<string, unknown>) {
  return webhook.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-unknown-type",
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
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    ...message,
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  });
}

function count(table: string, tenantId: string): number {
  return (
    db
      .prepare(`SELECT COUNT(*) as c FROM ${table} WHERE tenant_id = ?`)
      .get(tenantId) as { c: number }
  ).c;
}

describe("a message type the parser does not know", () => {
  it("is not read as text", () => {
    for (const type of ["reaction", "location", "sticker", "contacts", "??"]) {
      const parsed = parseIncomingMessage({
        id: "wamid-1",
        from: CUSTOMER,
        type,
      });
      expect(parsed.type).not.toBe("text");
    }
  });

  it("still reads the types it knows", () => {
    for (const type of ["text", "image", "document", "audio", "video"]) {
      expect(
        parseIncomingMessage({ id: "wamid-1", from: CUSTOMER, type }).type,
      ).toBe(type as never);
    }
  });

  describe("arriving at the webhook", () => {
    let tenant: TenantFixture;

    beforeEach(() => {
      applySchema();
      tenant = createTenantFixture("unknown-type");
    });

    afterEach(() => {
      dropTenantFixture(tenant);
    });

    for (const [type, payload] of [
      ["reaction", { reaction: { message_id: "wamid-x", emoji: "\u{1F44D}" } }],
      ["location", { location: { latitude: -12.04, longitude: -77.03 } }],
      ["sticker", { sticker: { id: "media-1", mime_type: "image/webp" } }],
    ] as const) {
      it(`ignores a ${type} like any other non-text message`, async () => {
        const messageId = `wamid-${crypto.randomUUID()}`;

        const response = await deliver(tenant.phoneNumberId, {
          id: messageId,
          type,
          ...payload,
        });

        expect(response.status).toBe(200);
        expect(
          (
            (await response.json()) as {
              results: Array<{ phoneNumberId: string; status: string }>;
            }
          ).results,
        ).toEqual([
          { phoneNumberId: tenant.phoneNumberId, status: "non_text_ignored" },
        ]);
        expect(count("message_inbox", tenant.tenantId)).toBe(0);
        expect(count("messages", tenant.tenantId)).toBe(0);
        expect(count("conversations", tenant.tenantId)).toBe(0);
      });
    }

    it("still queues a text message", async () => {
      const response = await deliver(tenant.phoneNumberId, {
        id: `wamid-${crypto.randomUUID()}`,
        type: "text",
        text: { body: "hola" },
      });

      expect(
        ((await response.json()) as { results: Array<{ status: string }> })
          .results[0]?.status,
      ).toBe("received");
      expect(count("message_inbox", tenant.tenantId)).toBe(1);
    });
  });
});

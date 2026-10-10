import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import process from "node:process";

import { GREETING } from "@vendeya/core";

import { db } from "../src/db/index.ts";
import { processReadyMessages } from "../src/conversation/aggregator-worker.ts";
import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import { ChannelAccountService } from "../src/domains/channels/accounts.ts";
import webhook from "../src/routes/webhook.ts";
import {
  applySchema,
  createTenantFixture,
  dropTenantFixture,
  type TenantFixture,
} from "./helpers/tenancy.ts";
import { signedWebhookRequest } from "./helpers/webhook.ts";

const CUSTOMER = "51900555001";

describe("messages queued before the greeting is processed", () => {
  let savedKey: string | undefined;
  let tenant: TenantFixture;
  let originalFetch: typeof globalThis.fetch;
  let delivered: string[];

  beforeEach(() => {
    savedKey = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "f1".repeat(32);

    applySchema();
    tenant = createTenantFixture("queued-greeting");
    db.prepare("DELETE FROM channel_accounts WHERE id = ?").run(
      tenant.channelAccountId,
    );
    const account = ChannelAccountService.create({
      tenantId: tenant.tenantId,
      phoneNumberId: tenant.phoneNumberId,
      accessToken: "EAAG-a-real-looking-token",
    });
    tenant.channelAccountId = account.id;

    delivered = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        type?: string;
        text?: { body?: string };
      };
      if (body.type === "text" && body.text?.body) {
        delivered.push(body.text.body);
      }
      return new Response(
        JSON.stringify({ messages: [{ id: `wamid-out-${delivered.length}` }] }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedKey;
    dropTenantFixture(tenant);
  });

  async function customerSends(messages: string[]): Promise<void> {
    const timestamp = Math.floor((Date.now() - 11 * 60 * 1000) / 1000);
    for (const [index, body] of messages.entries()) {
      const response = await webhook.request(
        "/",
        signedWebhookRequest({
          object: "whatsapp_business_account",
          entry: [
            {
              id: "waba-queued-greeting",
              changes: [
                {
                  field: "messages",
                  value: {
                    messaging_product: "whatsapp",
                    metadata: {
                      phone_number_id: tenant.phoneNumberId,
                    },
                    messages: [
                      {
                        from: CUSTOMER,
                        id: `wamid-in-${crypto.randomUUID()}-${index}`,
                        timestamp: String(timestamp + index),
                        type: "text",
                        text: { body },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }),
      );

      expect(response.status).toBe(200);
    }
  }

  it("sends one greeting for a burst and interprets the next answer", async () => {
    await customerSends(["Hola", "Hola", "?"]);

    db.prepare(
      "UPDATE message_inbox SET created_at = created_at - 60000 WHERE channel_account_id = ?",
    ).run(tenant.channelAccountId);

    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM message_inbox WHERE channel_account_id = ? AND status = 'pending'",
          )
          .get(tenant.channelAccountId) as { count: number }
      ).count,
    ).toBe(3);
    expect(
      JSON.parse(
        (
          db
            .prepare(
              "SELECT context_data FROM conversations WHERE tenant_id = ? AND channel_account_id = ? AND phone_number = ?",
            )
            .get(tenant.tenantId, tenant.channelAccountId, CUSTOMER) as {
            context_data: string;
          }
        ).context_data,
      ).phase,
    ).toEqual({ phase: "greeting" });

    await processReadyMessages();

    expect(delivered).toHaveLength(1);
    expect(GREETING.flat()).toContain(delivered[0]!);
    expect(delivered.join(" ")).not.toContain("no te entendí");
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM message_inbox WHERE channel_account_id = ? AND status = 'processed'",
          )
          .get(tenant.channelAccountId) as { count: number }
      ).count,
    ).toBe(3);

    await customerSends(["Sí"]);
    db.prepare(
      "UPDATE message_inbox SET created_at = created_at - 60000 WHERE channel_account_id = ? AND status = 'pending'",
    ).run(tenant.channelAccountId);
    await processReadyMessages();

    expect(
      MessageStore.getHistory(
        {
          tenantId: tenant.tenantId,
          channelAccountId: tenant.channelAccountId,
          phoneNumber: CUSTOMER,
        },
        20,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "outbound",
          content: expect.stringMatching(/DNI/i),
          status: "sent",
        }),
      ]),
    );
  });
});

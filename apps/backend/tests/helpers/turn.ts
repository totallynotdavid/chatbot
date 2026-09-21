import { expect } from "bun:test";

import { db } from "../../src/db/index.ts";
import webhook from "../../src/routes/webhook.ts";
import { signedWebhookRequest } from "./webhook.ts";
import type { TenantFixture } from "./tenancy.ts";

/**
 * The customer writes in over the signed webhook, and the inbox row is
 * backdated past the aggregator's quiet window. The next `processReadyMessages`
 * answers it, with no wait for a timer.
 */
export async function customerWrites(
  tenant: TenantFixture,
  phoneNumber: string,
  text: string,
): Promise<void> {
  // Old enough that `calculateResponseDelay` adds no pacing sleep to the turn.
  const sentAt = Math.floor((Date.now() - 11 * 60 * 1000) / 1000);

  const response = await webhook.request(
    "/",
    signedWebhookRequest({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-turn",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "51900000000",
                  phone_number_id: tenant.phoneNumberId,
                },
                messages: [
                  {
                    from: phoneNumber,
                    id: `wamid-${crypto.randomUUID()}`,
                    timestamp: String(sentAt),
                    type: "text",
                    text: { body: text },
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

  db.prepare(
    "UPDATE message_inbox SET created_at = created_at - 60000 WHERE channel_account_id = ?",
  ).run(tenant.channelAccountId);
}
